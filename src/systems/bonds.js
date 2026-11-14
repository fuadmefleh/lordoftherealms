// ============================================
// BONDS — friendships beyond romance
// ============================================
// The relationship score (systems/relationships) says how much someone likes
// the player. A BOND is more: a friendship with a kind and a strength, kept
// on player.bonds, that the two of you have built.
//
//   Forms       with anyone you know well (rel.score >= formAt; not your
//               spouse). Its kind: a Friend; a Drinking Companion (most of
//               it built at the inn); a Rival Turned Friend (you were once at
//               each other's throats: rel.score fell to -30 or below first);
//               later a Mentor, a Protégé, an Old Family Friend.
//   Grows       through shared deeds: drinking together (Drink with them, a
//               round at the tavern while they are there), fighting side by
//               side (a battle with them in your travel party), the road
//               (each day in your party), helping them in need (a matter
//               answered well — relationships/matters.js), gifts, promises
//               kept (systems/npcChatImpact.js), talk (free talk), visits.
//   Fades       with neglect: past graceDays without seeing them it loses
//               strength daily (sworn kin hardly at all); a strong bond let
//               fall far breeds a grievance. At 0 you have drifted apart.
//   Milestones  Sworn kinship: an oath before a church or your own hearth,
//               with them beside you (strength >= oath.minStrength). A
//               Mentor: an older friend teaches you their best skill — XP
//               each day you keep company — until you match them. A Protégé:
//               you take a youth of the town under your wing and teach them
//               your best skill on every visit; a few years on they grow into
//               a capable, loyal ally you may take into your service (the
//               court, else the road).
//   Friends act They take up arms beside you (battleAid — a power multiplier
//               in player combat), press coin into your hand when your purse
//               is empty (a loan from their own purse, to be repaid), vouch
//               for you before their realm (reputation), warn you of an
//               enemy's blow (forewarn — a nemesis act foiled) and of the
//               rumours about you in their town (systems/hearsay.js), and
//               come to visit.
//   Betrayal    A friend may turn: bought by your enemy (a nemesis, a rival
//               House) — the weaker the bond and greedier the friend, the
//               likelier; slighted (a grievance grown large); or on learning
//               what you did to their kin (systems/npcMemory.js). And you may
//               betray them: sell their confidences for an informer's fee —
//               a grudge (Nemesis.wrong), a rumour of it (Hearsay), their
//               family's memory.
//   Heirs       at a succession the late ruler's strong bonds pass, weakened,
//               as Old Family Friends (relationships are cleared for the new
//               head; these are re-seeded). Protégés stay with the House.
//
// LLM: personaLines gives the free-talk persona one line about the bond
// (systems/npcChat.js); the reply schema is untouched.
//
// Rules: explicit params, no domain globals. The daily turn draws from its
// own seeded stream (world seed + day, Utils.withRng), so no other system's
// dice move; battle aid and warnings are pure hashes. State on player.bonds
// (saved, systems/saveLoad.js). Content and tuning in data/bonds.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { Economy } from '../world/economy.js';
import { Relationships } from './relationships.js';
import { Townsfolk } from './townsfolk.js';
import { PracticeSkills } from './practiceSkills.js';
import { SocialSkills, SOCIAL_SKILL_IDS } from './socialSkills.js';
import { Court } from './court.js';
import { House } from './house.js';
import { Housing } from './housing.js';
import { Nemesis } from './nemesis.js';
import { Hearsay } from './hearsay.js';
import { NpcMemory } from './npcMemory.js';
import { Traits } from './traits.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => _num(world && world.day);
const _r1 = (v) => Math.round(v * 10) / 10;
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return h >>> 0;
}
const _h01 = (key) => _hash(key) / 4294967296;

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

const DEFAULTS = {
    formAt: 40, startStrength: 22, maxBonds: 24, maxPast: 30, historyCap: 12,
    kinds: { friend: { icon: '🤝', label: 'Friend', decay: 1 } },
    sworn: { icon: '🩸', brother: 'Sworn Brother', sister: 'Sworn Sister', decay: 0.3 },
    deeds: {},
    neglect: { graceDays: 30, perDay: 0.2, grievanceFromDrop: 30, grievancePerDay: 0.08, grievanceFade: 0.06 },
    drink: { cost: 4, cooldownDays: 1, social: 20, fun: 10 },
    gift: { cost: 15, cooldownDays: 10 },
    oath: { minStrength: 75, cost: 30, baseChance: 0.55 },
    vouch: { minStrength: 50, cooldownDays: 60, perStrength: 0.12, swornMult: 1.5 },
    aid: {
        battle: { minStrength: 50, per: 0.05, swornMult: 2, maxMult: 0.2, range: 1 },
        debt: { below: 10, minStrength: 55, cooldownDays: 90, base: 25, perStrength: 0.6, dueDays: 60, overdueGrievance: 15, overdueStrength: 10 },
        warn: { minStrength: 45, per: 0.35, sworn: 0.15, max: 0.6 },
        rumour: { minStrength: 40, minReach: 0.3 },
        visit: { minStrength: 50, chance: 0.018 },
    },
    mentor: { minStrength: 40, minAge: 28, dailyXp: 7, gapBonus: 0.15 },
    protege: { minAge: 10, maxAge: 17, cost: 30, dailyXp: 9, daysToGrow: 240, maxActive: 2, grownStrength: 70, grownLoyalty: 90, grownScore: 65 },
    betrayal: {
        bribeBase: 0.025, bribeTraits: {}, swornMult: 0.15, grievanceAt: 60, grievanceChance: 0.25, kinWrongAt: -6,
        stealShare: 0.15, stealMax: 250, secretsRep: 12, sellBase: 30, sellPerStrength: 1.2, nemesisBase: 40,
    },
    inherit: { min: 30, carry: 0.5, swornCarry: 0.65, scoreShare: 0.6 },
    mentorSkills: {},
    lines: {},
};

// Rumours a friend would warn you of (systems/hearsay.js kinds)
const BAD_RUMOURS = ['threat', 'contradiction', 'broken_promise', 'confession', 'betrayal', 'friend_turned'];

export const Bonds = {
    config() {
        const g = DataLoader._gamedata;
        const d = (g && g.bonds) || {};
        const out = { ...DEFAULTS, ...d };
        for (const k of ['neglect', 'drink', 'gift', 'oath', 'vouch', 'mentor', 'protege', 'betrayal', 'inherit', 'sworn']) out[k] = { ...DEFAULTS[k], ...(d[k] || {}) };
        out.aid = { ...DEFAULTS.aid };
        for (const k of Object.keys(DEFAULTS.aid)) out.aid[k] = { ...DEFAULTS.aid[k], ...((d.aid || {})[k] || {}) };
        return out;
    },

    _line(key, vars) {
        return _fill(Bonds.config().lines[key] || key, vars);
    },

    kindDef(id) {
        const K = Bonds.config().kinds;
        return K[id] || K.friend || DEFAULTS.kinds.friend;
    },

    // ── State ───────────────────────────────────────────

    state(player) {
        if (!player) return null;
        if (!player.bonds || typeof player.bonds !== 'object') player.bonds = {};
        const st = player.bonds;
        if (!Array.isArray(st.list)) st.list = [];
        if (!Array.isArray(st.past)) st.past = [];
        if (!Array.isArray(st.proteges)) st.proteges = [];
        if (!st.rivalMarks || typeof st.rivalMarks !== 'object') st.rivalMarks = {};
        if (!st.warned || typeof st.warned !== 'object') st.warned = {};
        if (!st.closed || typeof st.closed !== 'object') st.closed = {};
        if (!(st.nextId > 0)) st.nextId = 1;
        return st;
    },

    serialize(player) {
        return player && player.bonds ? JSON.parse(JSON.stringify(player.bonds)) : null;
    },

    loadState(player) {
        if (player && player.bonds) Bonds.state(player);
    },

    list(player) {
        return player && player.bonds && Array.isArray(player.bonds.list) ? player.bonds.list : [];
    },

    get(player, npcId) {
        return Bonds.list(player).find(b => b.npcId === npcId) || null;
    },

    /** The bond with whoever a free-talk subject is (relationship NPC or a town-map person). */
    forSubject(player, who) {
        if (!player || !who) return null;
        const list = Bonds.list(player);
        if (who.npc && who.npc.id) {
            const b = list.find(x => x.npcId === who.npc.id);
            if (b) return b;
        }
        const keys = [who.key, who.npc && who.npc.folkUid, who.npc && who.npc.uid].filter(Boolean);
        return list.find(x => keys.includes(x.npcId) || (x.folkUid && keys.includes(x.folkUid))) || null;
    },

    /** "Sworn Sister", "Drinking Companion", … */
    label(b, npc = null) {
        if (!b) return '';
        if (b.sworn) {
            const S = Bonds.config().sworn;
            const g = (npc && npc.gender) || b.gender;
            return g === 'female' ? S.sister : S.brother;
        }
        return Bonds.kindDef(b.kind).label;
    },

    icon(b) {
        if (!b) return '';
        return b.sworn ? Bonds.config().sworn.icon : Bonds.kindDef(b.kind).icon;
    },

    _npc(id) {
        return Relationships.getNPC(id);
    },

    _name(npc, b = null) {
        if (npc) return `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}`;
        return (b && b.name) || 'your friend';
    },

    _here(player, world) {
        if (!player || !world || typeof world.getTile !== 'function') return null;
        const t = world.getTile(player.q, player.r);
        return t && t.settlement ? { tile: t, settlement: t.settlement } : null;
    },

    /** Are you with them today? 'party' | 'court' | 'town' | null */
    together(player, world, npc) {
        if (!player || !npc || npc.isAlive === false) return null;
        if (Relationships.isInTravelParty(player, npc.id)) return 'party';
        if (Court.isMember(player, npc.id)) return 'court';
        const here = Bonds._here(player, world);
        if (here && here.settlement.name && here.settlement.name === npc.settlementName) return 'town';
        return null;
    },

    _note(b, day, key, extra = '') {
        const D = Bonds.config().deeds[key] || {};
        const h = (b.history = b.history || []);
        const last = h[0];
        // Repeated small deeds stack on one line (the road, talk)
        if (last && last.k === key && day - last.d <= 30 && !extra) {
            last.n = (last.n || 1) + 1;
            last.d = day;
        } else {
            h.unshift({ d: day, k: key, t: extra || D.label || key });
            if (h.length > Bonds.config().historyCap) h.length = Bonds.config().historyCap;
        }
    },

    // ── Forming and ending ──────────────────────────────

    /** Make a bond with a relationship NPC (idempotent). opts { kind, strength, note }. */
    form(player, world, npcId, opts = {}) {
        const st = Bonds.state(player);
        const had = Bonds.get(player, npcId);
        if (had) return had;
        const npc = Bonds._npc(npcId);
        if (!npc || npc.isAlive === false) return null;
        const C = Bonds.config();
        const day = _day(world);
        const b = {
            id: st.nextId++, npcId, name: Bonds._name(npc), gender: npc.gender || null, folkUid: npc.folkUid || null,
            kind: opts.kind || 'friend', strength: _r1(_clamp(_num(opts.strength, C.startStrength), 1, 100)),
            peak: 0, formed: day, lastSeen: day, grievance: 0, sworn: null, mentor: null, owed: null,
            inherited: 0, deeds: {}, cd: {}, history: [],
        };
        b.peak = b.strength;
        st.list.push(b);
        Bonds._note(b, day, 'formed', opts.note || (b.kind === 'rival_friend' ? 'old rivals, now friends' : 'became friends'));
        while (st.list.length > C.maxBonds) {
            const weakest = st.list.filter(x => !x.sworn && x.kind !== 'protege').sort((x, y) => x.strength - y.strength)[0];
            if (!weakest) break;
            Bonds._end(player, world, weakest, 'drifted', null, null);
        }
        return b;
    },

    _end(player, world, b, how, text, out) {
        const st = Bonds.state(player);
        const C = Bonds.config();
        st.list = st.list.filter(x => x !== b);
        st.past.unshift({ npcId: b.npcId, name: b.name, kind: b.kind, sworn: !!b.sworn, formed: b.formed, strength: Math.round(b.strength), ended: { day: _day(world), how, text: text || null } });
        if (st.past.length > C.maxPast) st.past.length = C.maxPast;
        if (how === 'betrayed' || how === 'betrayed_you' || how === 'turned') st.closed[b.npcId] = _day(world);
        // Drifted apart: the regard cools too, or the bond would only form again tomorrow
        if (how === 'drifted' && player.relationships && player.relationships[b.npcId]) {
            const rel = player.relationships[b.npcId];
            rel.score = Math.min(_num(rel.score), C.formAt - 10);
        }
        if (out && text) out.notices.push({ icon: how === 'died' ? '🕯️' : how === 'drifted' ? '🍂' : '🗡️', title: how === 'died' ? 'A Friend Is Gone' : how === 'drifted' ? 'Drifted Apart' : 'A Friend Turns', text, type: how === 'drifted' || how === 'died' ? 'info' : 'error' });
    },

    /**
     * A shared deed: strength (and a little relationship score) gained.
     * opts { mult, note }. → the gain (0 without a bond).
     */
    deed(player, world, npcId, key, opts = {}) {
        const b = typeof npcId === 'object' && npcId ? npcId : Bonds.get(player, npcId);
        if (!b) return 0;
        const D = Bonds.config().deeds[key] || {};
        const day = _day(world);
        // The stronger the bond, the less each deed adds (and sworn kin are near the top already)
        const room = Math.max(0.25, 1 - b.strength / 140);
        const gain = _num(D.gain, 1) * _num(opts.mult, 1) * room;
        b.strength = _r1(Math.min(100, b.strength + gain));
        b.peak = Math.max(_num(b.peak), b.strength);
        b.deeds[key] = _num(b.deeds[key]) + 1;
        b.lastSeen = Math.max(_num(b.lastSeen), day);
        b.grievance = Math.max(0, _num(b.grievance) - gain * 0.5);
        if (key !== 'road' && key !== 'talk' && key !== 'taught') Bonds._note(b, day, key, opts.note || '');
        else if (key === 'road' && b.deeds.road % 10 === 1) Bonds._note(b, day, key);
        const rel = player.relationships && player.relationships[b.npcId];
        if (rel) rel.score = _clamp(_num(rel.score) + gain * 0.4, -100, 100);
        Bonds._reKind(b);
        return gain;
    },

    /** Drinking deeds outweighing all else make a drinking companion of a plain friend. */
    _reKind(b) {
        if (b.kind !== 'friend') return;
        const d = b.deeds || {};
        const drinks = _num(d.drink) + _num(d.round);
        const other = _num(d.battle) + _num(d.help) + _num(d.gift) + _num(d.promise) + _num(d.defeat);
        if (drinks >= 4 && drinks > other * 2) {
            b.kind = 'drinking';
            b._kindNews = 'drinkKind';
        }
    },

    // ── The daily turn (ui/game/endDay.js) ──────────────

    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !world) return out;
        if (!player.bonds && !Object.keys(player.relationships || {}).length) return out;
        const st = Bonds.state(player);
        const day = _day(world);
        const rng = Utils.seededRandom((_hash(`${_seed(world)}:bonds:${day}`) % 233279) + 1);
        Utils.withRng(rng, () => {
            Bonds._watchSuccession(player, world, out);
            Bonds._scanForming(player, world, out);
            for (const b of [...st.list]) Bonds._dayOf(player, world, b, out);
            Bonds._proteges(player, world, out);
            Bonds._debtAid(player, world, out);
            Bonds._visit(player, world, out);
            Bonds._rumourWarnings(player, world, out);
            if (day % 7 === 0) Bonds._betrayals(player, world, out);
            // Old warnings forgotten
            for (const [k, d] of Object.entries(st.warned)) if (day - d > 240) delete st.warned[k];
        });
        return out;
    },

    _watchSuccession(player, world, out) {
        const st = Bonds.state(player);
        const gen = player.house ? _num(player.house.generation, 1) : 0;
        const key = `${gen}|${player.name || ''}`;
        if (st.ruler && st.ruler !== key) {
            if (gen > _num(st.gen)) Bonds._inherit(player, world, out, st.rulerName || 'the late head');
            else Bonds._archive(player, world);
        }
        st.ruler = key;
        st.gen = gen;
        st.rulerName = player.firstName || player.name || null;
    },

    /** A new head of the House: the late ruler's strong bonds pass on as old family friends. */
    _inherit(player, world, out, oldName) {
        const C = Bonds.config();
        const I = C.inherit;
        const st = Bonds.state(player);
        const day = _day(world);
        let count = 0;
        for (const b of [...st.list]) {
            const npc = Bonds._npc(b.npcId);
            if (!npc || npc.isAlive === false) { Bonds._end(player, world, b, 'died', null, null); continue; }
            if (b.kind === 'protege') { b.lastSeen = day; continue; }
            if (b.strength < I.min) { Bonds._end(player, world, b, 'drifted', `${b.name} was ${oldName}'s friend, not yours.`, null); continue; }
            b.strength = _r1(b.strength * (b.sworn ? I.swornCarry : I.carry));
            if (b.sworn) b.swornTo = oldName;
            b.sworn = null;
            b.mentor = null;
            b.wasKind = b.kind;
            b.kind = 'family_friend';
            b.inherited = _num(b.inherited) + 1;
            b.grievance = 0;
            b.peak = b.strength;
            b.lastSeen = day;
            Bonds._note(b, day, 'inherited', `friend to ${oldName}, now to the House`);
            const rel = Relationships.getRelationship(player, b.npcId);
            rel.score = Math.max(_num(rel.score), Math.round(b.strength * I.scoreShare));
            count++;
        }
        if (count) out.notices.push({ icon: '🏛️', title: 'Old Family Friends', text: Bonds._line('inherited', { count, old: oldName }), type: 'info' });
    },

    /** A new life (not an heir): the old bonds were someone else's. */
    _archive(player, world) {
        const st = Bonds.state(player);
        for (const b of [...st.list]) Bonds._end(player, world, b, 'parted', 'another life', null);
        st.proteges = [];
    },

    _scanForming(player, world, out) {
        const C = Bonds.config();
        const st = Bonds.state(player);
        const day = _day(world);
        for (const [npcId, rel] of Object.entries(player.relationships || {})) {
            if (!rel) continue;
            const score = _num(rel.score);
            if (score <= -30) st.rivalMarks[npcId] = day;
            if (score < C.formAt || npcId === player.spouse || Bonds.get(player, npcId) || st.closed[npcId] != null) continue;
            const npc = Bonds._npc(npcId);
            if (!npc || npc.isAlive === false || npc.betrayedPlayer != null) continue;
            const rival = st.rivalMarks[npcId] != null;
            const b = Bonds.form(player, world, npcId, { kind: rival ? 'rival_friend' : 'friend', strength: C.startStrength + (score - C.formAt) / 2 });
            if (!b) continue;
            if (rival) delete st.rivalMarks[npcId];
            if (out.notices.length < 2) {
                out.notices.push({ icon: rival ? '⚔️' : '🤝', title: rival ? 'Old Rivals, New Friends' : 'A New Friend', text: Bonds._line(rival ? 'rivalFriend' : 'formed', { name: b.name }), type: 'success' });
            }
        }
    },

    /** One bond's day: together or apart, deeds noticed, neglect, debts, the mentor's lesson. */
    _dayOf(player, world, b, out) {
        const C = Bonds.config();
        const day = _day(world);
        const npc = Bonds._npc(b.npcId);
        if (!npc || npc.isAlive === false) {
            const cause = npc && npc.deathCause ? ` (${npc.deathCause})` : '';
            Bonds._end(player, world, b, 'died', Bonds._line('died', { name: b.name, kind: Bonds.label(b, npc).toLowerCase(), cause }), out);
            if (b.sworn && player.house) House._chronicle(player.house, world, `${b.name}, ${Bonds.label(b, npc).toLowerCase()} to ${player.name}, dies.`, ['bonds']);
            return;
        }
        b.name = Bonds._name(npc);
        const rel = player.relationships && player.relationships[b.npcId];
        const where = Bonds.together(player, world, npc);
        if (where) {
            b.lastSeen = day;
            if (where === 'party' && b.cd.road !== day) { b.cd.road = day; Bonds.deed(player, world, b, 'road'); }
            if (b.mentor && !b.mentor.done) Bonds._lesson(player, world, b, npc, out);
        }
        // Free talk with them today (systems/npcChat.js noteTalk)
        if (rel && Array.isArray(rel.history) && b.cd.talk !== day) {
            const h = rel.history[rel.history.length - 1];
            if (h && h.action === 'chat' && h.day === day) { b.cd.talk = day; Bonds.deed(player, world, b, 'talk'); }
        }
        // A matter they brought you, answered (relationships/matters.js stamps rel.lastMatter)
        const lm = rel && rel.lastMatter;
        if (lm && `${lm.day}|${lm.kind}|${lm.opt}` !== b.seenMatter) {
            b.seenMatter = `${lm.day}|${lm.kind}|${lm.opt}`;
            if (lm.tone === 'good') Bonds.deed(player, world, b, 'help', { note: 'stood by them when they asked' });
            else if (lm.tone === 'bad') { b.grievance = _num(b.grievance) + 10; b.strength = Math.max(0, b.strength - 4); }
        }
        // Promises to them, kept or broken (systems/npcChatImpact.js)
        for (const p of (player.npcChat && player.npcChat.promises) || []) {
            if (p.key !== b.npcId && p.key !== b.folkUid && p.folkRef !== b.folkUid) continue;
            if (p.state === 'kept' && !p.bk) { p.bk = 1; Bonds.deed(player, world, b, 'promise', { note: `kept your word: ${String(p.text || '').slice(0, 40)}` }); }
            if (p.state === 'broken' && !p.bb) { p.bb = 1; b.grievance = _num(b.grievance) + 15; b.strength = Math.max(0, b.strength - 6); }
        }
        // Neglect
        const N = C.neglect;
        const apart = day - _num(b.lastSeen, day);
        if (apart > N.graceDays) {
            const mult = b.sworn ? C.sworn.decay : _num(Bonds.kindDef(b.kind).decay, 1);
            b.strength = _r1(Math.max(0, b.strength - N.perDay * mult));
        }
        if (_num(b.peak) - b.strength > N.grievanceFromDrop) b.grievance = _num(b.grievance) + N.grievancePerDay;
        else b.grievance = Math.max(0, _num(b.grievance) - N.grievanceFade);
        // Coin they lent you, overdue
        if (b.owed && day > b.owed.due && !b.owed.late) {
            const D = C.aid.debt;
            b.owed.late = true;
            b.grievance = _num(b.grievance) + D.overdueGrievance;
            b.strength = Math.max(0, b.strength - D.overdueStrength);
            out.notices.push({ icon: '💸', title: 'A Debt to a Friend', text: Bonds._line('overdue', { name: b.name, amount: b.owed.amount }), type: 'warning' });
        }
        if (b._kindNews) {
            out.notices.push({ icon: '🍺', title: 'A Drinking Companion', text: Bonds._line(b._kindNews, { name: b.name }), type: 'success' });
            delete b._kindNews;
        }
        if (b.strength <= 0 && b.kind !== 'protege') Bonds._end(player, world, b, 'drifted', Bonds._line('drifted', { name: b.name }), out);
    },

    // ── Mentors ─────────────────────────────────────────

    _playerLevel(player, id) {
        return SOCIAL_SKILL_IDS.includes(id) ? SocialSkills.level(player, id) : PracticeSkills.level(player, id);
    },

    _teach(player, id, xp) {
        if (SOCIAL_SKILL_IDS.includes(id)) return SocialSkills.train(player, id, xp);
        const ev = PracticeSkills.gain(player, id, xp);
        if (ev) PracticeSkills.queueUp(player, ev);
        return ev;
    },

    /** What a friend could teach you: their best skill above yours. → { skill, level, name } | null */
    mentorSkill(player, world, npc) {
        if (!npc) return null;
        const best = { skill: null, level: 0 };
        const found = npc.folkUid ? Relationships.folkPerson(world, npc.folkUid) : null;
        if (found) {
            Townsfolk.skillsOf(found.folk, found.p, world);
            for (const id of PracticeSkills.ids()) {
                const L = PracticeSkills.level(found.p, id);
                if (L > best.level && L > Bonds._playerLevel(player, id)) { best.skill = id; best.level = L; }
            }
        }
        if (!best.skill) {
            const id = Bonds.config().mentorSkills[String(npc.occupation || '').toLowerCase()];
            if (id && PracticeSkills.def(id)) {
                const L = 3 + (_hash(`${npc.id}|mentor`) % 4);
                if (L > Bonds._playerLevel(player, id)) { best.skill = id; best.level = L; }
            }
        }
        if (!best.skill) return null;
        const d = PracticeSkills.def(best.skill) || {};
        return { skill: best.skill, level: best.level, name: d.name || best.skill, icon: d.icon || '⭐' };
    },

    _lesson(player, world, b, npc, out) {
        const M = Bonds.config().mentor;
        const m = b.mentor;
        if (b.cd.lesson === _day(world)) return;
        b.cd.lesson = _day(world);
        const mine = Bonds._playerLevel(player, m.skill);
        if (mine >= m.level) {
            m.done = _day(world);
            out.notices.push({ icon: '📜', title: 'A Mentor\'s Last Lesson', text: Bonds._line('mentorDone', { name: b.name, skill: m.name }), type: 'success' });
            Bonds._note(b, _day(world), 'taught', `taught you all they know of ${m.name}`);
            return;
        }
        const xp = M.dailyXp * (1 + (m.level - mine) * M.gapBonus);
        Bonds._teach(player, m.skill, xp);
        m.xp = _r1(_num(m.xp) + xp);
        m.days = _num(m.days) + 1;
        Bonds.deed(player, world, b, 'taught');
    },

    askMentor(player, world, npcId) {
        const v = Bonds._acts(player, world, Bonds.get(player, npcId)).mentor;
        if (!v.ok) return { success: false, reason: v.reason };
        const b = Bonds.get(player, npcId);
        b.mentor = { skill: v.skill.skill, name: v.skill.name, level: v.skill.level, since: _day(world), xp: 0, days: 0, done: null };
        if (b.kind === 'friend' || b.kind === 'drinking') b.kind = 'mentor';
        Bonds._note(b, _day(world), 'mentor', `began to teach you ${v.skill.name}`);
        return { success: true, text: Bonds._line('mentorStart', { name: b.name, skill: v.skill.name }) };
    },

    // ── Protégés ────────────────────────────────────────

    /** The youths of the town you stand in who could be taken under your wing. */
    protegeCandidates(player, world) {
        const here = Bonds._here(player, world);
        const folk = here && here.settlement.folk;
        if (!folk || !Array.isArray(folk.people)) return [];
        const P = Bonds.config().protege;
        const day = _day(world);
        const taken = new Set(Bonds.state(player).proteges.map(x => x.uid));
        return folk.people.filter(p => Townsfolk.isHere(p) && !taken.has(Relationships.folkUid(folk, p))
            && Townsfolk.age(p, day) >= P.minAge && Townsfolk.age(p, day) <= P.maxAge)
            .sort((a, b) => a.id - b.id).slice(0, 6)
            .map(p => ({ p, folk, uid: Relationships.folkUid(folk, p), name: Townsfolk.name(p), age: Townsfolk.age(p, day), gender: p.gender }));
    },

    /** The skill you would teach: your best. */
    _yourBestSkill(player) {
        let best = null;
        for (const id of PracticeSkills.ids()) {
            const L = Bonds._playerLevel(player, id);
            if (!best || L > best.level) best = { skill: id, level: L };
        }
        if (!best) return null;
        const d = PracticeSkills.def(best.skill) || {};
        return { ...best, name: d.name || best.skill };
    },

    takeProtege(player, world, uid) {
        const P = Bonds.config().protege;
        const st = Bonds.state(player);
        const c = Bonds.protegeCandidates(player, world).find(x => x.uid === uid);
        if (!c) return { success: false, reason: 'There is no such youth here.' };
        if (st.proteges.filter(x => !x.grown).length >= P.maxActive) return { success: false, reason: `You can take only ${P.maxActive} protégés at a time.` };
        if (_num(player.gold) < P.cost) return { success: false, reason: `You need ${P.cost} gold for their keep and tools.` };
        const sk = Bonds._yourBestSkill(player);
        if (!sk || sk.level < 2) return { success: false, reason: 'You have no skill worth teaching yet.' };
        player.gold -= P.cost;
        // (the youth's family keeps the purse: it goes to the town)
        Economy.payTown(Bonds._here(player, world).settlement, P.cost);
        const day = _day(world);
        const town = Bonds._here(player, world).settlement.name;
        st.proteges.push({ uid, name: c.name, gender: c.gender, skill: sk.skill, skillName: sk.name, since: day, taught: 0, town, q: c.folk.q, r: c.folk.r, grown: null, npcId: null });
        c.p.protegeOf = player.house ? player.house.name : (player.name || 'a stranger');
        NpcMemory.remember(world, { folk: c.folk, person: c.p }, { kind: 'kept_faith', player, kin: true, note: 'took them under their wing' });
        return { success: true, text: Bonds._line('protegeStart', { name: c.name, age: c.age, town, skill: sk.name }) };
    },

    _proteges(player, world, out) {
        const P = Bonds.config().protege;
        const st = Bonds.state(player);
        const day = _day(world);
        for (const pr of [...st.proteges]) {
            if (pr.grown) continue;
            const found = Relationships.folkPerson(world, pr.uid);
            if (!found || found.p.died != null) {
                st.proteges = st.proteges.filter(x => x !== pr);
                if (found) out.notices.push({ icon: '🕯️', title: 'A Protégé Lost', text: `${pr.name}, the youth you took under your wing, has died${found.p.cause ? ` of ${found.p.cause}` : ''}.`, type: 'warning' });
                continue;
            }
            const { folk, p, settlement } = found;
            if (player.q === folk.q && player.r === folk.r && Townsfolk.isHere(p) && pr.lastDay !== day) {
                pr.lastDay = day;
                pr.taught = _num(pr.taught) + 1;
                Townsfolk.skillsOf(folk, p, world);
                PracticeSkills.gain(p, pr.skill, P.dailyXp);
            }
            if (pr.taught >= P.daysToGrow && Townsfolk.age(p, day) >= Townsfolk.config().comeOfAge && Townsfolk.isHere(p)) {
                const res = Relationships.fromTownsperson(player, world, folk, p, settlement);
                if (!res.success) continue;
                const npc = res.npc;
                npc.loyalty = Math.max(_num(npc.loyalty, 50), P.grownLoyalty);
                npc.capable = true;
                // Capable: the years of teaching show in what they can do for a House (systems/court.js skills)
                const csk = Court.ensureSkills(npc);
                if (csk) for (const k of Object.keys(csk)) csk[k] = Math.min(_num(Court.config().skillCap, 10), _num(csk[k]) + 2);
                npc.protegeOf = player.house ? player.house.name : player.name;
                if (!Array.isArray(npc.traits)) npc.traits = [];
                if (!npc.traits.includes('loyal')) npc.traits.push('loyal');
                const rel = Relationships.getRelationship(player, npc.id);
                rel.score = Math.max(_num(rel.score), P.grownScore);
                pr.grown = day;
                pr.npcId = npc.id;
                const b = Bonds.get(player, npc.id) || Bonds.form(player, world, npc.id, { kind: 'protege', strength: P.grownStrength, note: `grew up under your wing in ${pr.town}` });
                if (b) { b.kind = 'protege'; b.strength = Math.max(b.strength, P.grownStrength); b.peak = Math.max(_num(b.peak), b.strength); b.protegeSkill = pr.skillName; }
                out.notices.push({ icon: '🌱', title: 'A Protégé Comes of Age', text: Bonds._line('protegeGrown', { name: pr.name, skill: String(pr.skillName || 'hand').toLowerCase() }), type: 'success' });
                if (player.house) House._chronicle(player.house, world, `${pr.name} of ${pr.town}, raised under ${player.name}'s wing, comes into their own.`, ['bonds']);
            }
        }
        // Grown ones: the record stays a few years, then the bond carries it
        st.proteges = st.proteges.filter(x => !x.grown || day - x.grown < 720);
    },

    /** A grown protégé (or any strong friend) into your service: the court, else the road. */
    takeIntoService(player, world, npcId) {
        const v = Bonds._acts(player, world, Bonds.get(player, npcId)).service;
        if (!v.ok) return { success: false, reason: v.reason };
        const b = Bonds.get(player, npcId);
        const npc = Bonds._npc(npcId);
        if (player.house) {
            const res = Court.join(player, world, npcId, { free: true, loyalty: Math.max(70, _num(npc.loyalty, 50)) });
            if (!res.success) return res;
            Bonds._note(b, _day(world), 'service', 'took a place at your court');
            return { success: true, text: `${b.name} takes a place at your court, and gladly.` };
        }
        Relationships.ensureTravelParty(player);
        if (!player.travelParty.includes(npcId)) player.travelParty.push(npcId);
        npc.isTravelingWithPlayer = true;
        if (npc.folkUid) Relationships._syncOne(player, world, npc);
        Bonds._note(b, _day(world), 'service', 'took the road with you');
        return { success: true, text: `${b.name} packs a bag and takes the road with you.` };
    },

    // ── Friends act ─────────────────────────────────────

    _near(player, world, npc, range) {
        if (Bonds.together(player, world, npc)) return true;
        if (npc.settlementQ == null || player.q == null || !world) return false;
        return Hex.wrappingDistance(player.q, player.r, npc.settlementQ, npc.settlementR, world.width || 0) <= range;
    },

    /**
     * Friends who take up arms beside you in a fight (player combat): those
     * near enough with a strong bond. Pure (no dice). → { mult, names, ids }
     */
    battleAid(player, world) {
        const out = { mult: 1, names: [], ids: [] };
        if (!player || !player.bonds) return out;
        const A = Bonds.config().aid.battle;
        let add = 0;
        for (const b of Bonds.list(player)) {
            if (b.strength < A.minStrength || (b.kind === 'protege' && !b.protegeSkill)) continue;
            const npc = Bonds._npc(b.npcId);
            if (!npc || npc.isAlive === false || !Bonds._near(player, world, npc, A.range)) continue;
            add += (b.strength / 100) * A.per * (b.sworn ? A.swornMult : 1);
            out.names.push(npc.firstName);
            out.ids.push(b.npcId);
        }
        out.mult = 1 + Math.min(A.maxMult, add);
        return out;
    },

    /**
     * A battle fought (player/playerMilitary/combat.js, player/fieldBattle.js):
     * the friends in your party, and those who came to your aid, fought beside you.
     */
    onBattle(player, world, victory, enemyName = 'the enemy') {
        if (!player || !player.bonds) return;
        const day = _day(world);
        const aid = Bonds.battleAid(player, world);
        for (const b of Bonds.list(player)) {
            const npc = Bonds._npc(b.npcId);
            if (!npc || npc.isAlive === false) continue;
            const inParty = Relationships.isInTravelParty(player, b.npcId);
            if (!inParty && !aid.ids.includes(b.npcId)) continue;
            if (b.cd.battle === day) continue;
            b.cd.battle = day;
            Bonds.deed(player, world, b, victory ? 'battle' : 'defeat', { note: `${victory ? 'fought beside you against' : 'stood with you against'} ${enemyName}` });
        }
    },

    /** A round bought at the tavern (player/tavern): friends in town drink it with you. */
    onTavernRound(player, world) {
        if (!player || !player.bonds) return 0;
        const day = _day(world);
        let n = 0;
        for (const b of Bonds.list(player)) {
            const npc = Bonds._npc(b.npcId);
            const where = npc ? Bonds.together(player, world, npc) : null;
            if (where !== 'town' && where !== 'party') continue;
            if (b.cd.round === day) continue;
            b.cd.round = day;
            Bonds.deed(player, world, b, 'round');
            n++;
        }
        return n;
    },

    /**
     * An enemy's blow (systems/nemesis.js _act): a friend who got wind of it
     * warns you. Pure hash. → { text, npcId } | null
     */
    forewarn(player, world, enemyName, actKind = 'plot') {
        if (!player || !player.bonds) return null;
        const W = Bonds.config().aid.warn;
        const day = _day(world);
        let best = null;
        for (const b of Bonds.list(player)) {
            if (b.strength < W.minStrength) continue;
            const npc = Bonds._npc(b.npcId);
            if (!npc || npc.isAlive === false) continue;
            const chance = Math.min(W.max, (b.strength / 100) * W.per + (b.sworn ? W.sworn : 0));
            const roll = _h01(`${_seed(world)}|warn|${day}|${enemyName}|${actKind}|${b.npcId}`);
            if (roll < chance && (!best || b.strength > best.strength)) best = b;
        }
        if (!best) return null;
        Bonds.deed(player, world, best, 'aid', { note: `warned you of ${enemyName}` });
        return { npcId: best.npcId, name: best.name, text: Bonds._line('warnPlot', { name: best.name, enemy: enemyName }) };
    },

    _debtAid(player, world, out) {
        const D = Bonds.config().aid.debt;
        const st = Bonds.state(player);
        const day = _day(world);
        if (_num(player.gold) >= D.below || day - _num(st.lastDebtAid, -1e9) < D.cooldownDays) return;
        const b = Bonds.list(player).filter(x => x.strength >= D.minStrength && !x.owed && x.kind !== 'protege')
            .sort((x, y) => y.strength - x.strength)[0];
        if (!b) return;
        const npc = Bonds._npc(b.npcId);
        if (!npc || npc.isAlive === false) return;
        const want = Math.round(D.base + b.strength * D.perStrength * (b.sworn ? 1.5 : 1));
        const purse = Bonds.purseOf(npc);
        const amount = Math.floor(Math.min(want, purse));
        if (amount < 5) return;
        npc.purse = _r1(purse - amount);
        player.gold = _num(player.gold) + amount;
        b.owed = { amount, day, due: day + D.dueDays };
        st.lastDebtAid = day;
        Bonds.deed(player, world, b, 'aid', { note: `lent you ${amount} gold when you were short` });
        out.notices.push({ icon: '🫱', title: 'A Friend in Need', text: Bonds._line('aidDebt', { name: b.name, amount }), type: 'success' });
    },

    /** Their purse (relationship NPCs carry one: systems/npcChat.js); savings seeded once from who they are. */
    purseOf(npc) {
        if (!npc) return 0;
        if (typeof npc.purse !== 'number') npc.purse = 20 + Math.floor(_h01(`${npc.id}|savings`) * 110);
        return Math.max(0, npc.purse);
    },

    repay(player, world, npcId) {
        const b = Bonds.get(player, npcId);
        if (!b || !b.owed) return { success: false, reason: 'You owe them nothing.' };
        if (_num(player.gold) < b.owed.amount) return { success: false, reason: `You need ${b.owed.amount} gold.` };
        const npc = Bonds._npc(npcId);
        player.gold -= b.owed.amount;
        if (npc) npc.purse = _r1(Bonds.purseOf(npc) + b.owed.amount);
        const amount = b.owed.amount;
        const late = b.owed.late;
        b.owed = null;
        if (!late) Bonds.deed(player, world, b, 'promise', { note: `repaid the ${amount} gold they lent you` });
        else b.grievance = Math.max(0, _num(b.grievance) - 10);
        return { success: true, text: Bonds._line('repaid', { name: b.name, amount }) };
    },

    _visit(player, world, out) {
        const V = Bonds.config().aid.visit;
        const here = Bonds._here(player, world);
        if (!here) return;
        for (const b of Bonds.list(player)) {
            if (b.strength < V.minStrength) continue;
            const npc = Bonds._npc(b.npcId);
            if (!npc || npc.isAlive === false || Bonds.together(player, world, npc)) continue;
            if (Utils.random() >= V.chance) continue;
            Bonds.deed(player, world, b, 'visit', { note: `came to see you in ${here.settlement.name}` });
            if (player.needs && typeof player.needs === 'object') player.needs.social = Math.min(100, _num(player.needs.social) + 25);
            out.notices.push({ icon: '🚪', title: 'A Friend Calls', text: Bonds._line('visit', { name: b.name, town: here.settlement.name }), type: 'success' });
            return;
        }
    },

    _rumourWarnings(player, world, out) {
        const R = Bonds.config().aid.rumour;
        const hs = player.hearsay;
        if (!hs || !Array.isArray(hs.rumours) || !hs.rumours.length) return;
        const st = Bonds.state(player);
        for (const b of Bonds.list(player)) {
            if (b.strength < R.minStrength) continue;
            const npc = Bonds._npc(b.npcId);
            if (!npc || npc.isAlive === false || npc.settlementQ == null) continue;
            const tk = `${npc.settlementQ},${npc.settlementR}`;
            for (const r of hs.rumours) {
                const e = r.towns && r.towns[tk];
                if (!e || _num(e.r) < R.minReach || st.warned[r.id] != null) continue;
                if (!BAD_RUMOURS.includes(r.k) && !e.x) continue;
                st.warned[r.id] = _day(world);
                const telling = Hearsay.telling(r, tk, player.name || 'you');
                out.notices.push({ icon: '✉️', title: `Word from ${b.name}`, text: Bonds._line('warnRumour', { name: b.name, town: npc.settlementName || 'their town', telling: telling.charAt(0).toLowerCase() + telling.slice(1).replace(/\.$/, '') }), type: 'info' });
                return;
            }
        }
    },

    // ── Betrayal ────────────────────────────────────────

    /** Who might buy a friend's treachery: a nemesis, else the bitterest rival House. */
    _briber(player) {
        const nm = Nemesis.active(player)[0];
        if (nm) return { name: nm.name, nm };
        const rivals = Object.values((player.house && player.house.rivals) || {}).filter(r => r && _num(r.feud) >= 30).sort((a, b) => _num(b.feud) - _num(a.feud));
        return rivals[0] ? { name: rivals[0].name || 'a rival House' } : null;
    },

    _kinWrong(player, world, b) {
        if (!b.folkUid) return null;
        const found = Relationships.folkPerson(world, b.folkUid);
        if (!found) return null;
        const at = Bonds.config().betrayal.kinWrongAt;
        const mems = NpcMemory.recall(world, { folk: found.folk, person: found.p }, { about: player, scope: 'self', includeTown: false });
        return mems.find(m => m.weight <= at && m.day >= _num(b.formed) && m.kind !== 'promise_broken') || null;
    },

    _betrayals(player, world, out) {
        const B = Bonds.config().betrayal;
        const briber = Bonds._briber(player);
        for (const b of [...Bonds.list(player)]) {
            const npc = Bonds._npc(b.npcId);
            if (!npc || npc.isAlive === false) continue;
            const kin = Bonds._kinWrong(player, world, b);
            if (kin) { Bonds._turned(player, world, b, npc, 'kin', { wrong: kin }, out); return; }
            if (_num(b.grievance) >= B.grievanceAt && Utils.random() < B.grievanceChance) { Bonds._turned(player, world, b, npc, 'slight', {}, out); return; }
            if (!briber || b.kind === 'protege') continue;
            let mult = 1;
            for (const t of npc.traits || []) mult *= _num(B.bribeTraits[t], 1);
            const loyal = 1 - (_num(npc.loyalty, 50) - 50) / 100;
            const weak = Math.pow(1 - b.strength / 100, 2);
            const chance = B.bribeBase * mult * weak * Math.max(0.1, loyal) * (b.sworn ? B.swornMult : 1);
            if (Utils.random() < chance) { Bonds._turned(player, world, b, npc, 'bribe', { briber }, out); return; }
        }
    },

    /** A friend turns on you. */
    _turned(player, world, b, npc, why, ctx, out) {
        const B = Bonds.config().betrayal;
        const day = _day(world);
        let text;
        if (why === 'kin') {
            text = Bonds._line('betrayKin', { name: b.name });
            Nemesis.wrong(player, world, {
                kind: 'blood', name: b.name, ref: b.folkUid ? { folkRef: b.folkUid } : {}, line: npc.dynasty || null,
                deed: { key: 'kin_wronged', label: 'what you did to their family', note: ctx.wrong && ctx.wrong.label }, score: B.nemesisBase + b.strength / 2,
                age: npc.age, gender: npc.gender,
            });
        } else if (why === 'slight') {
            text = Bonds._line('betraySlight', { name: b.name });
            Bonds._rumour(player, world, npc, 'friend_turned', 'they use people and cast them off');
            const kid = npc.kingdomId != null ? npc.kingdomId : player.allegiance;
            if (kid != null && player.reputation) player.reputation[kid] = Math.max(-100, _num(player.reputation[kid]) - 5);
        } else {
            const inParty = Relationships.isInTravelParty(player, b.npcId);
            const greedy = (npc.traits || []).some(t => t === 'greedy' || t === 'cunning');
            if (inParty && greedy && _num(player.gold) > 50) {
                const amount = Math.min(B.stealMax, Math.floor(_num(player.gold) * B.stealShare));
                player.gold -= amount;
                npc.purse = _r1(Bonds.purseOf(npc) + amount);
                text = Bonds._line('betrayStole', { name: b.name, amount });
            } else {
                text = Bonds._line('betrayBribe', { name: b.name, rival: ctx.briber ? ctx.briber.name : 'an enemy' });
                const kid = player.allegiance != null ? player.allegiance : npc.kingdomId;
                if (kid != null && player.reputation) player.reputation[kid] = Math.max(-100, _num(player.reputation[kid]) - B.secretsRep);
                // What they sold: your habits, to the enemy who paid (systems/nemesis.js reads them)
                const nm = ctx.briber && ctx.briber.nm;
                if (nm) {
                    nm.read = nm.read || {};
                    nm.read.place = Math.min(1, _num(nm.read.place) + 0.3);
                    nm.read.route = Math.min(1, _num(nm.read.route) + 0.2);
                }
            }
        }
        if (Relationships.isInTravelParty(player, b.npcId)) Relationships.removeFromTravelParty(player, b.npcId);
        const rel = Relationships.getRelationship(player, b.npcId);
        rel.score = Math.min(_num(rel.score), -40);
        npc.betrayedPlayer = day;
        Bonds._end(player, world, b, 'betrayed_you', text, out);
    },

    /** Talk of it in their town (systems/hearsay.js). */
    _rumour(player, world, npc, kind, what) {
        if (!npc || npc.settlementQ == null) return null;
        const st = Hearsay.state(player);
        const tk = `${npc.settlementQ},${npc.settlementR}`;
        const name = npc.firstName || 'someone';
        return Hearsay._rumour(st, { k: kind, tp: kind, v: what, d: _day(world), o: tk, on: npc.settlementName || 'town', te: name, tk: npc.folkUid || npc.id, w: what });
    },

    /** You betray a friend: their confidences sold for an informer's fee. */
    betray(player, world, npcId) {
        const b = Bonds.get(player, npcId);
        const npc = Bonds._npc(npcId);
        if (!b || !npc) return { success: false, reason: 'There is no such friend.' };
        const B = Bonds.config().betrayal;
        const day = _day(world);
        const fee = Math.round(B.sellBase + b.strength * B.sellPerStrength);
        // The fee is real coin: the crown of their realm pays its informers, else their town's watch
        const k = world && Array.isArray(world.kingdoms) ? world.kingdoms.find(x => x && x.id === npc.kingdomId) : null;
        let paid = 0;
        if (k && _num(k.treasury) >= fee) { k.treasury -= fee; paid = fee; }
        else {
            const found = npc.folkUid ? Relationships.folkPerson(world, npc.folkUid) : null;
            const town = found ? found.settlement : null;
            paid = town ? Math.floor(Economy.drawTown(town, fee)) : 0;
        }
        player.gold = _num(player.gold) + paid;
        const rel = Relationships.getRelationship(player, npcId);
        rel.score = -70;
        npc.loyalty = 0;
        npc.betrayedByPlayer = day;
        if (Relationships.isInTravelParty(player, npcId)) Relationships.removeFromTravelParty(player, npcId);
        if (Court.isMember(player, npcId)) Court._remove(player, world, npcId, 'left');
        player.karma = _num(player.karma) - (b.sworn ? 10 : 5);
        Traits.recordDeed(player, 'deceit', b.sworn ? 4 : 2);
        Nemesis.wrong(player, world, {
            kind: 'blood', name: b.name, ref: b.folkUid ? { folkRef: b.folkUid } : {}, line: npc.dynasty || null,
            deed: { key: 'betrayal', label: b.sworn ? 'the oath of kinship you broke' : 'the friendship you sold', note: `${fee} gold` },
            score: B.nemesisBase + b.strength / 2 + (b.sworn ? 20 : 0), age: npc.age, gender: npc.gender,
        });
        Bonds._rumour(player, world, npc, 'betrayal', `sold out ${b.name}, who called them friend`);
        if (b.folkUid) {
            const found = Relationships.folkPerson(world, b.folkUid);
            if (found) NpcMemory.remember(world, { folk: found.folk, person: found.p }, { kind: 'betrayed_friend', player, kin: true, note: b.sworn ? 'an oath of kinship' : null });
        }
        if (b.sworn && player.house) House._chronicle(player.house, world, `${player.name} breaks the oath of kinship sworn with ${b.name}.`, ['bonds']);
        const text = Bonds._line('youBetray', { name: b.name, amount: paid });
        Bonds._end(player, world, b, 'betrayed', text, null);
        return { success: true, text, paid };
    },

    // ── What you can do with a friend ───────────────────

    _oathPlace(player, world) {
        const here = Bonds._here(player, world);
        if (!here) return null;
        if (Housing.getHouseAt(player, player.q, player.r)) return 'your own hearth';
        const s = here.settlement;
        const word = s.type === 'capital' ? 'the cathedral' : s.type === 'village' ? 'the chapel' : 'the church';
        return `${word} of ${s.name}`;
    },

    /** Each action's availability for one bond. */
    _acts(player, world, b) {
        const C = Bonds.config();
        const no = (reason) => ({ ok: false, reason });
        if (!b) {
            const x = no('No such friend.');
            return { drink: x, gift: x, oath: x, mentor: x, vouch: x, repay: x, service: x, betray: x };
        }
        const npc = Bonds._npc(b.npcId);
        const day = _day(world);
        const where = npc ? Bonds.together(player, world, npc) : null;
        const away = `${b.name} is not here (${npc && npc.settlementName ? `in ${npc.settlementName}` : 'away'}).`;
        const gold = _num(player.gold);
        const out = {};
        out.drink = !where ? no(away)
            : b.cd.drink != null && day - b.cd.drink < C.drink.cooldownDays ? no('You drank together today already.')
                : gold < C.drink.cost ? no(`You need ${C.drink.cost} gold.`) : { ok: true, cost: C.drink.cost };
        out.gift = !where ? no(away)
            : b.cd.gift != null && day - b.cd.gift < C.gift.cooldownDays ? no(`You gave them something lately (again in ${C.gift.cooldownDays - (day - b.cd.gift)} days).`)
                : gold < C.gift.cost ? no(`You need ${C.gift.cost} gold.`) : { ok: true, cost: C.gift.cost };
        const place = Bonds._oathPlace(player, world);
        out.oath = b.sworn ? no('You are already sworn kin.')
            : b.kind === 'protege' && !b.protegeSkill ? no('They are too young.')
                : b.strength < C.oath.minStrength ? no(`The bond must be stronger (${Math.round(b.strength)}/${C.oath.minStrength}).`)
                    : !where ? no(away)
                        : !place ? no('Swear it before a church or at your own hearth — in a settlement.')
                            : gold < C.oath.cost ? no(`You need ${C.oath.cost} gold for the feast and the priest.`)
                                : { ok: true, cost: C.oath.cost, place, chance: Bonds._oathChance(b, npc) };
        const sk = npc ? Bonds.mentorSkill(player, world, npc) : null;
        out.mentor = b.mentor && !b.mentor.done ? no(`They are teaching you ${b.mentor.name}.`)
            : b.mentor && b.mentor.done && (!sk || sk.skill === b.mentor.skill) ? no('They have taught you all they know.')
                : b.kind === 'protege' ? no('You are the one who teaches them.')
                    : b.strength < C.mentor.minStrength ? no(`The bond must be stronger (${Math.round(b.strength)}/${C.mentor.minStrength}).`)
                        : npc && _num(npc.age) < C.mentor.minAge ? no(`${b.name} is too young to be anyone's mentor.`)
                            : !sk ? no(`${b.name} knows nothing you don't.`)
                                : !where ? no(away) : { ok: true, skill: sk };
        const kid = npc ? npc.kingdomId : null;
        out.vouch = b.strength < C.vouch.minStrength ? no(`The bond must be stronger (${Math.round(b.strength)}/${C.vouch.minStrength}).`)
            : kid == null ? no('They have no standing in any realm.')
                : b.cd.vouch != null && day - b.cd.vouch < C.vouch.cooldownDays ? no(`They spoke for you lately (again in ${C.vouch.cooldownDays - (day - b.cd.vouch)} days).`)
                    : !where ? no(away) : { ok: true, gain: Bonds._vouchGain(b), kingdomId: kid };
        out.repay = !b.owed ? no('You owe them nothing.') : gold < b.owed.amount ? no(`You need ${b.owed.amount} gold.`) : { ok: true, cost: b.owed.amount };
        out.service = Court.isMember(player, b.npcId) || Relationships.isInTravelParty(player, b.npcId) ? no('They already serve with you.')
            : b.strength < 60 ? no(`The bond must be stronger (${Math.round(b.strength)}/60).`)
                : npc && npc.governing ? no('They govern one of your holdings.')
                    : !where ? no(away) : { ok: true, court: !!player.house };
        const B = C.betrayal;
        out.betray = { ok: true, fee: Math.round(B.sellBase + b.strength * B.sellPerStrength) };
        return out;
    },

    _oathChance(b, npc) {
        const C = Bonds.config().oath;
        const loyal = (_num(npc && npc.loyalty, 50) - 50) * 0.006;
        return _clamp(C.baseChance + (b.strength - C.minStrength) * 0.015 + loyal, 0.1, 0.97);
    },

    _vouchGain(b) {
        const V = Bonds.config().vouch;
        return Math.max(1, Math.round(b.strength * V.perStrength * (b.sworn ? V.swornMult : 1)));
    },

    drinkWith(player, world, npcId) {
        const b = Bonds.get(player, npcId);
        const v = Bonds._acts(player, world, b).drink;
        if (!v.ok) return { success: false, reason: v.reason };
        const C = Bonds.config().drink;
        const here = Bonds._here(player, world);
        player.gold -= C.cost;
        if (here) Economy.payTown(here.settlement, C.cost);
        b.cd.drink = _day(world);
        Traits.recordDeed(player, 'drinking', 1);
        if (player.needs && typeof player.needs === 'object') {
            player.needs.social = Math.min(100, _num(player.needs.social) + C.social);
            player.needs.fun = Math.min(100, _num(player.needs.fun) + C.fun);
        }
        const gain = Bonds.deed(player, world, b, 'drink');
        const lines = ['You drink to old times and new ones.', 'The ale is poor and the company is good.', 'You trade stories until the innkeeper sweeps around your feet.', 'Someone starts a song; the two of you finish it, badly.'];
        return { success: true, text: `${lines[_hash(`${npcId}|${_day(world)}`) % lines.length]} (${b.name}: bond +${_r1(gain)})` };
    },

    giveGift(player, world, npcId) {
        const b = Bonds.get(player, npcId);
        const v = Bonds._acts(player, world, b).gift;
        if (!v.ok) return { success: false, reason: v.reason };
        const npc = Bonds._npc(npcId);
        const C = Bonds.config().gift;
        player.gold -= C.cost;
        npc.purse = _r1(Bonds.purseOf(npc) + C.cost);
        b.cd.gift = _day(world);
        Traits.recordDeed(player, 'generosity', 1);
        const gain = Bonds.deed(player, world, b, 'gift');
        return { success: true, text: `${b.name} turns the gift over in their hands and smiles. (bond +${_r1(gain)})` };
    },

    swearOath(player, world, npcId) {
        const b = Bonds.get(player, npcId);
        const v = Bonds._acts(player, world, b).oath;
        if (!v.ok) return { success: false, reason: v.reason };
        const npc = Bonds._npc(npcId);
        const C = Bonds.config().oath;
        const here = Bonds._here(player, world);
        player.gold -= C.cost;
        if (here) Economy.payTown(here.settlement, C.cost);
        if (Utils.random() >= v.chance) {
            b.cd.oath = _day(world);
            return { success: true, sworn: false, text: Bonds._line('oathFailed', { name: b.name }) };
        }
        const day = _day(world);
        b.sworn = { day, place: v.place };
        Bonds.deed(player, world, b, 'oath', { note: `swore kinship before ${v.place}` });
        npc.loyalty = Math.max(_num(npc.loyalty, 50), 80);
        Traits.recordDeed(player, 'honesty', 1);
        const sworn = Bonds.label(b, npc).toLowerCase();
        if (player.house) {
            House._chronicle(player.house, world, `${player.name} and ${b.name} swear kinship before ${v.place}.`, ['bonds']);
            House.award(player.house, 1, `sworn kin: ${b.name}`, day);
        }
        if (b.folkUid) {
            const found = Relationships.folkPerson(world, b.folkUid);
            if (found) NpcMemory.remember(world, { folk: found.folk, person: found.p }, { kind: 'kept_faith', player, kin: true, note: 'sworn kin' });
        }
        return { success: true, sworn: true, text: Bonds._line('oath', { name: b.name, place: v.place, sworn: `${sworn}s`.replace(/ss$/, 's') }) };
    },

    askVouch(player, world, npcId) {
        const b = Bonds.get(player, npcId);
        const v = Bonds._acts(player, world, b).vouch;
        if (!v.ok) return { success: false, reason: v.reason };
        if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {};
        player.reputation[v.kingdomId] = Math.min(100, _num(player.reputation[v.kingdomId]) + v.gain);
        b.cd.vouch = _day(world);
        const k = world && Array.isArray(world.kingdoms) ? world.kingdoms.find(x => x && x.id === v.kingdomId) : null;
        Bonds._note(b, _day(world), 'vouch', `spoke for you in ${k ? k.name : 'their realm'}`);
        return { success: true, text: `${Bonds._line('vouch', { name: b.name, realm: k ? k.name : 'their realm' })} (+${v.gain} reputation)` };
    },

    // ── Views ───────────────────────────────────────────

    /** Everything the Friends & Bonds panel shows. */
    view(player, world) {
        const st = Bonds.state(player);
        const day = _day(world);
        const bonds = st.list.map(b => {
            const npc = Bonds._npc(b.npcId);
            return {
                b, npc, label: Bonds.label(b, npc), icon: Bonds.icon(b), where: npc ? Bonds.together(player, world, npc) : null,
                apart: day - _num(b.lastSeen, day), acts: Bonds._acts(player, world, b),
            };
        }).sort((x, y) => (y.b.sworn ? 1 : 0) - (x.b.sworn ? 1 : 0) || y.b.strength - x.b.strength);
        const proteges = st.proteges.map(pr => {
            const found = Relationships.folkPerson(world, pr.uid);
            const P = Bonds.config().protege;
            return { pr, age: found ? Townsfolk.age(found.p, day) : null, left: Math.max(0, P.daysToGrow - _num(pr.taught)), here: !!found && player.q === found.folk.q && player.r === found.folk.r };
        });
        return { bonds, proteges, candidates: Bonds.protegeCandidates(player, world), past: st.past, aid: Bonds.battleAid(player, world), teach: Bonds._yourBestSkill(player) };
    },

    /** For the free-talk persona (systems/npcChat.js): one or two lines on the bond. */
    personaLines(player, world, who) {
        const b = Bonds.forSubject(player, who);
        if (!b) return [];
        const npc = Bonds._npc(b.npcId);
        const pName = player.name || 'they';
        const strength = Math.round(b.strength);
        const depth = strength >= 80 ? 'as close as kin' : strength >= 55 ? 'close' : strength >= 30 ? 'good friends' : 'friends, though it has cooled';
        let line = b.sworn
            ? `You and ${pName} are sworn kin by oath (${Bonds.label(b, npc).toLowerCase()}), sworn before ${b.sworn.place}: you would die for each other.`
            : `${pName} is your ${Bonds.label(b, npc).toLowerCase()} — ${depth} (bond ${strength}/100).`;
        const d = b.deeds || {};
        const shared = [
            _num(d.drink) + _num(d.round) ? 'drinking together' : null,
            _num(d.battle) + _num(d.defeat) ? 'fighting side by side' : null,
            _num(d.road) >= 5 ? 'the road' : null,
            _num(d.help) ? 'the time they helped you' : null,
        ].filter(Boolean);
        if (shared.length) line += ` You share ${shared.join(', ')}.`;
        if (b.kind === 'rival_friend') line += ' You were bitter rivals once, and still tease each other about it.';
        if (b.kind === 'family_friend') line += ` You were a friend of their family before them${b.swornTo ? ` (sworn kin to ${b.swornTo})` : ''}.`;
        if (b.mentor && !b.mentor.done) line += ` You are teaching them ${b.mentor.name}.`;
        if (b.kind === 'protege') line += ' They took you under their wing when you were young; you owe them much.';
        const lines = [line];
        if (_num(b.grievance) >= 25) lines.push('Lately you feel taken for granted by them, and it rankles.');
        if (b.owed) lines.push(`You lent them ${b.owed.amount} gold${b.owed.late ? ', and they are late repaying it' : ''}.`);
        return lines;
    },
};
