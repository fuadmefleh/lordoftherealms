// ============================================
// VANISHINGS — the companions who never came home
// ============================================
// A townsperson who takes the road with the player and dies away from home
// leaves a family waiting for them. Each such loss is recorded and scored for
// suspicion: a death in open battle, seen by others, is grief; one no one saw,
// of a companion the player was at odds with, who had coin on them, by a
// player with a criminal name, or the third from the same town, looks like
// foul play. Tuned in data/vanishings.json.
//
//   player.vanishings = { next, list: [rec] }   (saved)
//   rec = { id, d, npcId, uid (roster 'q,r#id' or null), name, q, r, town, how
//           ('battle'|'sickness'|'old_age'|'unknown'), cause, enemy, s (suspicion
//           0..max), tier ('grief'|'doubt'|'foul'), w (witnesses), told (day | null),
//           nw (no word came: day | null), acc (accused), ann (noticed) }
//
// The suspicion is written into the systems that already carry it:
//   NpcMemory — the lost one's kin remember it (lost_with / vanished_with /
//     foul_play, then no_word or brought_word), the town too when it is more than
//     grief; that reaches prices, work, testimony, greetings and the LLM's memories.
//   Relationships — the regard of kin the player knows drops; the next asked to
//     join from that town are warier (joinWariness, read by requestJoinTravelParty).
//   Gossip — doubt is talk ('vanished_talk'); foul play an accusation
//     ('vanished_companion') that can grow in the telling and turn the watch.
//   NpcChatImpact.personaLines — kin bring it up in free talk (personaLines).
// Bringing word: the player who comes to the town tells the family (processDay),
// which softens it (less so the stronger the suspicion); no word in noWordDays
// hardens it.
//
// Called from: Companions.fall (battle, sickness), Relationships aging (old age
// on the road), Relationships._syncOne (any other death away with the player).
// No randomness; no globals.

import { DataLoader } from '../core/dataLoader.js';
import { NpcMemory } from './npcMemory.js';
import { Gossip } from './gossip.js';
import { Townsfolk } from './townsfolk.js';

const DEFAULTS = {
    enabled: true, how: { battle: 0.1, sickness: 0.3, old_age: 0.05, unknown: 0.55 },
    unwitnessed: 0.25, witnessCut: 0.1, townWitnessCut: 0.2, witnessCutMax: 0.35,
    lowRegard: 0.4, quarrel: 0.15, quarrelApproval: 30, criminal: 0.25, criminalBounty: 50, criminalKarma: -30,
    profit: 0.15, profitMin: 10, pattern: 0.2, patternTown: 0.15, patternDays: 1800, patternMax: 4, max: 2,
    doubtAt: 0.4, foulAt: 0.9, noWordDays: 60, noWordRise: 0.2, tellCloseDays: 30, keep: 40,
    accuseBase: 0.4, accusePer: 0.5, accuseMax: 0.95, joinMax: 0.6, joinOwnPer: 0.01, joinRefuseAt: 10,
};
const KINDS = ['lost_with', 'vanished_with', 'foul_play', 'no_word'];

let _cfgCache = null;
let _cfgSrc;

const _num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const _r2 = v => Math.round(v * 100) / 100;
const _day = world => _num(world && world.day, 0);
const _fill = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : '')).replace(/\s+/g, ' ').trim();
const _alive = p => !!p && p.died == null;

function _uidParts(uid) {
    const m = /^(-?\d+),(-?\d+)#(\d+)$/.exec(String(uid || ''));
    return m ? { q: +m[1], r: +m[2], id: +m[3] } : null;
}

function _townAt(world, q, r) {
    if (q == null || !world || typeof world.getTile !== 'function') return null;
    const t = world.getTile(q, r);
    return t && t.settlement ? t.settlement : null;
}

export const Vanishings = {
    // ── Tuning ───────────────────────────────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && g.vanishings) || {};
    },

    config() {
        const d = Vanishings.data();
        if (_cfgCache && _cfgSrc === d) return _cfgCache;
        _cfgSrc = d;
        const c = (d && d.config) || {};
        _cfgCache = { ...DEFAULTS, ...c, how: { ...DEFAULTS.how, ...(c.how || {}) } };
        return _cfgCache;
    },

    tier(id) { return (Vanishings.data().tiers || {})[id] || {}; },

    state(player) {
        if (!player) return null;
        if (!player.vanishings || !Array.isArray(player.vanishings.list)) player.vanishings = { next: 1, list: [] };
        return player.vanishings;
    },

    // ── Who they were ────────────────────────────────

    /** The roster person behind a party NPC: { folk, p, settlement } or null. */
    personOf(world, npc) {
        const u = npc && _uidParts(npc.folkUid);
        if (!u) return null;
        const s = _townAt(world, u.q, u.r);
        const folk = s && s.folk;
        const p = folk ? Townsfolk.get(folk, u.id) : null;
        return p ? { folk, p, settlement: s } : null;
    },

    /** Where a party NPC calls home: { q, r, settlement } (or nulls). */
    homeOf(world, npc) {
        const u = npc && _uidParts(npc.folkUid);
        const q = u ? u.q : (npc && npc.settlementQ != null ? npc.settlementQ : null);
        const r = u ? u.r : (npc && npc.settlementR != null ? npc.settlementR : null);
        return { q, r, settlement: _townAt(world, q, r) };
    },

    // ── Suspicion ────────────────────────────────────

    /** Is the player's name a criminal one (a bounty, or a black soul)? */
    _criminal(player) {
        const C = Vanishings.config();
        if (_num(player.karma) <= C.criminalKarma) return true;
        const g = player.gossip;
        const bounty = g && Array.isArray(g.bounties) ? g.bounties.reduce((s, b) => s + _num(b.gold), 0) : 0;
        return bounty >= C.criminalBounty;
    },

    /**
     * How suspicious a loss looks: { s, tier, parts } — parts list what weighed.
     * info = { how, witnesses: [npc] (others of the party who saw it), home: { q, r } }.
     */
    suspicion(world, player, npc, info = {}) {
        const C = Vanishings.config();
        const day = _day(world);
        const how = C.how[info.how] != null ? info.how : 'unknown';
        const parts = [];
        let s = _num(C.how[how]);
        parts.push(how);
        // Who saw it and can carry the word home: a battle is seen by all who fought it
        const wit = (info.witnesses || []).filter(o => o && o !== npc && o.isAlive !== false);
        if (how !== 'battle' && !wit.length) { s += C.unwitnessed; parts.push('unwitnessed'); }
        if (wit.length) {
            const home = info.home || {};
            let cut = 0;
            for (const o of wit) {
                const h = _uidParts(o.folkUid) || { q: o.settlementQ, r: o.settlementR };
                cut += home.q != null && h.q === home.q && h.r === home.r ? C.townWitnessCut : C.witnessCut;
            }
            s -= Math.min(C.witnessCutMax, cut);
            parts.push('witnessed');
        }
        // At odds with the player
        const rel = player.relationships && player.relationships[npc.id];
        const score = rel ? _num(rel.score) : 0;
        if (score < 0) { s += C.lowRegard * Math.min(1, -score / 100); parts.push('low regard'); }
        const c = npc.companion;
        if (c && (_num(c.approval, 50) < C.quarrelApproval || c.gripe)) { s += C.quarrel; parts.push('quarrel'); }
        // A criminal name
        if (Vanishings._criminal(player)) { s += C.criminal; parts.push('criminal'); }
        // Coin that never came home
        if (_num(npc.purse) >= C.profitMin || _num(info.profit) >= C.profitMin) { s += C.profit; parts.push('profit'); }
        // The pattern: others lost with the player, more so from the same town
        const st = Vanishings.state(player);
        const home = info.home || {};
        const prior = st.list.filter(x => x.npcId !== npc.id && day - _num(x.d) <= C.patternDays && x.how !== 'old_age');
        let n = 0;
        for (const x of prior) {
            if (n >= C.patternMax) break;
            n++;
            s += C.pattern;
            if (home.q != null && x.q === home.q && x.r === home.r) s += C.patternTown;
        }
        if (n) parts.push(`pattern ×${n}`);
        s = _r2(Math.max(0, Math.min(C.max, s)));
        return { s, tier: Vanishings.tierOf(s), parts };
    },

    tierOf(s) {
        const C = Vanishings.config();
        return s >= C.foulAt ? 'foul' : s >= C.doubtAt ? 'doubt' : 'grief';
    },

    // ── The loss ─────────────────────────────────────

    /**
     * A party member has died away from home with the player. info = { how
     * ('battle'|'sickness'|'old_age'|'unknown'), cause?, enemy?, witnesses?: [npc],
     * profit? }. Idempotent per NPC (npc.vanishRec). → the record, or null.
     */
    onPartyLoss(world, player, npc, info = {}) {
        if (!world || !player || !npc || npc.vanishRec) return null;
        const C = Vanishings.config();
        if (C.enabled === false) return null;
        const home = Vanishings.homeOf(world, npc);
        const got = Vanishings.personOf(world, npc);
        if (!got && !home.settlement) return null; // no one at home to miss them
        const day = _day(world);
        const sus = Vanishings.suspicion(world, player, npc, { ...info, home });
        const st = Vanishings.state(player);
        const rec = {
            id: st.next++, d: day, npcId: npc.id, uid: npc.folkUid || null,
            name: `${npc.firstName || 'someone'}${npc.dynasty ? ` ${npc.dynasty}` : ''}`,
            q: home.q, r: home.r, town: (home.settlement && home.settlement.name) || npc.settlementName || 'their town',
            how: C.how[info.how] != null ? info.how : 'unknown', cause: info.cause || null, enemy: info.enemy || null,
            s: sus.s, tier: sus.tier, parts: sus.parts,
            w: (info.witnesses || []).filter(o => o && o !== npc).length, told: null, nw: null, acc: false, ann: false,
        };
        npc.vanishRec = rec.id;
        st.list.push(rec);
        if (st.list.length > C.keep) st.list.splice(0, st.list.length - C.keep);
        Vanishings._spread(world, player, rec, got);
        return rec;
    },

    /** Write the loss into the kin's and the town's memory, regard and talk. */
    _spread(world, player, rec, got) {
        const T = Vanishings.tier(rec.tier);
        const kind = T.kind || 'lost_with';
        const victim = rec.name;
        let kin = [];
        if (got) {
            kin = NpcMemory.rememberKin(world, { folk: got.folk, person: got.p }, { kind, player, note: rec.how });
            for (const k of kin) Vanishings._sour(player, k, T);
        }
        if (T.town && rec.q != null) NpcMemory.rememberTown(world, { q: rec.q, r: rec.r }, { kind, player, victim });
        if (T.talk && rec.q != null) {
            if (T.accuse) {
                Vanishings._accuse(world, player, rec);
            } else {
                Gossip.spreadDeed(player, world, T.talk, { q: rec.q, r: rec.r, victim });
            }
        }
        return kin;
    },

    _sour(player, k, T) {
        if (k.rnpc && player.relationships && player.relationships[k.rnpc]) {
            const rel = player.relationships[k.rnpc];
            rel.score = Math.max(-100, _num(rel.score) - _num(T.regard));
        }
        if (k.mem && Number.isFinite(k.mem.disposition)) k.mem.disposition = Math.max(0, k.mem.disposition - _num(T.disposition));
    },

    _accuse(world, player, rec) {
        if (rec.acc) return null;
        const C = Vanishings.config();
        rec.acc = true;
        const cred = Math.min(C.accuseMax, C.accuseBase + Math.max(0, rec.s - C.foulAt) * C.accusePer);
        return Gossip.accuse(player, world, 'vanished_companion', { q: rec.q, r: rec.r, victim: rec.name, credibility: cred });
    },

    /** How it happened, in words: "fell in battle against the Reavers". */
    howText(rec) {
        const H = Vanishings.data().howWords || {};
        return _fill(H[rec.how] || H.unknown || 'never came back', {
            enemy: rec.enemy ? ` against ${rec.enemy}` : '', cause: rec.cause || 'a sickness',
        });
    },

    // ── Bringing word, or none ───────────────────────

    /**
     * The player tells the family how it happened: their kin's memory of it softens
     * (by the tier's keepOnTell; sooner told, softer), and they remember the word
     * brought. → { success, text, told: [persons] }
     */
    tellFamily(world, player, recId) {
        const st = Vanishings.state(player);
        const rec = st && st.list.find(x => x.id === recId);
        if (!rec) return { success: false, reason: 'No such loss.' };
        if (rec.told != null) return { success: false, reason: 'You have already told them.' };
        const C = Vanishings.config();
        const day = _day(world);
        rec.told = day;
        const T = Vanishings.tier(rec.tier);
        let keep = _num(T.keepOnTell, 0.6);
        if (day - rec.d <= C.tellCloseDays) keep *= 0.85;
        const u = _uidParts(rec.uid);
        const s = _townAt(world, rec.q, rec.r);
        const folk = s && s.folk;
        const dead = u && folk ? Townsfolk.get(folk, u.id) : null;
        const told = [];
        if (dead) {
            for (const p of folk.people) {
                if (!_alive(p) || !Array.isArray(p.nm)) continue;
                let hit = false;
                for (const e of p.nm) {
                    if (!KINDS.includes(e.k) || e.vn !== rec.name) continue;
                    e.w = Math.round(e.w * (e.k === 'no_word' ? 0 : keep) * 10) / 10;
                    hit = true;
                }
                p.nm = p.nm.filter(e => e.w !== 0);
                if (!p.nm.length) delete p.nm;
                if (hit) told.push(p);
            }
            NpcMemory.rememberKin(world, { folk, person: dead }, { kind: 'brought_word', player });
        }
        // The town's memory of a doubtful loss eases a little with the truth told
        if (folk && Array.isArray(folk.nm)) {
            for (const e of folk.nm) if (KINDS.includes(e.k) && e.vn === rec.name) e.w = Math.round(e.w * Math.min(1, keep + 0.15) * 10) / 10;
        }
        const N = (Vanishings.data().notices || {}).told || {};
        const text = _fill(N.text || 'You tell {name}\'s family how it happened.', { name: rec.name, town: rec.town, how: Vanishings.howText(rec) });
        return { success: true, text, told, notice: { icon: N.icon || '🕯️', title: _fill(N.title || 'Word brought', { town: rec.town }), text, type: 'info' } };
    },

    /**
     * Daily: losses are made known; the player standing in the lost one's town
     * tells the family; a family left noWordDays without word hardens (a doubtful
     * loss can turn to foul play). → { notices }
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!world || !player || !player.vanishings || !Array.isArray(player.vanishings.list)) return out;
        const C = Vanishings.config();
        if (C.enabled === false) return out;
        const day = _day(world);
        const notices = Vanishings.data().notices || {};
        const note = (key, rec) => {
            const N = notices[key];
            if (!N) return;
            const vars = { name: rec.name, town: rec.town, how: Vanishings.howText(rec) };
            out.notices.push({ icon: N.icon || '📜', title: _fill(N.title, vars), text: _fill(N.text, vars), type: key === 'foul' || key === 'noWord' ? 'warning' : 'info' });
        };
        for (const rec of player.vanishings.list) {
            if (!rec.ann) {
                rec.ann = true;
                if (rec.tier !== 'grief') note(rec.tier, rec);
            }
            if (rec.told != null || rec.q == null) continue;
            if (player.q === rec.q && player.r === rec.r) {
                const r = Vanishings.tellFamily(world, player, rec.id);
                if (r.success) out.notices.push(r.notice);
                continue;
            }
            if (rec.nw == null && day - rec.d >= C.noWordDays) {
                rec.nw = day;
                const dead = Vanishings.personOf(world, { folkUid: rec.uid });
                if (dead && dead.p) NpcMemory.rememberKin(world, { folk: dead.folk, person: dead.p }, { kind: 'no_word', player });
                const was = rec.tier;
                rec.s = _r2(Math.min(C.max, rec.s + C.noWordRise));
                rec.tier = Vanishings.tierOf(rec.s);
                if (rec.tier !== was) {
                    // Hardened: the kin remember it as the graver thing, and the talk turns
                    if (dead && dead.p) {
                        const T = Vanishings.tier(rec.tier);
                        const kin = NpcMemory.rememberKin(world, { folk: dead.folk, person: dead.p }, { kind: T.kind, player, note: rec.how });
                        for (const k of kin) Vanishings._sour(player, k, { regard: _num(T.regard) - _num(Vanishings.tier(was).regard), disposition: _num(T.disposition) - _num(Vanishings.tier(was).disposition) });
                    }
                    const T = Vanishings.tier(rec.tier);
                    if (T.town) NpcMemory.rememberTown(world, { q: rec.q, r: rec.r }, { kind: T.kind, player, victim: rec.name });
                    if (T.accuse) Vanishings._accuse(world, player, rec);
                    else if (T.talk) Gossip.spreadDeed(player, world, T.talk, { q: rec.q, r: rec.r, victim: rec.name });
                }
                if (rec.tier !== 'grief') note('noWord', rec);
            }
        }
        return out;
    },

    // ── What it does ─────────────────────────────────

    /** Losses with the player from a town ({ q, r }), newest first. */
    fromTown(player, q, r) {
        const st = player && player.vanishings;
        if (!st || !Array.isArray(st.list) || q == null) return [];
        return st.list.filter(x => x.q === q && x.r === r).sort((a, b) => b.d - a.d);
    },

    /**
     * How much warier someone is of joining the player's party: { penalty (off the
     * chance), refuse (their words) | null }. From the losses out of their town and
     * what they themselves remember of one.
     */
    joinWariness(world, player, npc) {
        const out = { penalty: 0, refuse: null };
        if (!world || !player || !npc) return out;
        const C = Vanishings.config();
        if (C.enabled === false) return out;
        const day = _day(world);
        const home = Vanishings.homeOf(world, npc);
        for (const x of Vanishings.fromTown(player, home.q, home.r)) {
            if (x.npcId === npc.id || day - x.d > C.patternDays) continue;
            out.penalty += _num(Vanishings.tier(x.tier).join) * (x.told != null ? 0.5 : 1);
        }
        const got = Vanishings.personOf(world, npc);
        if (got) {
            const mems = NpcMemory.recall(world, { folk: got.folk, person: got.p }, { about: player, includeTown: false })
                .filter(m => KINDS.includes(m.kind));
            for (const m of mems) out.penalty += Math.abs(m.weight) * C.joinOwnPer;
            const worst = mems.filter(m => m.kind === 'foul_play' && Math.abs(m.weight) >= C.joinRefuseAt)[0];
            if (worst) {
                out.refuse = _fill(Vanishings.data().refuseJoin || 'Go with you? My {vr} {vn} went with you, and never came home.', { vr: worst.victimRel === 'self' ? 'kin' : worst.victimRel, vn: (worst.victimName || '').split(' ')[0] });
            }
        }
        out.penalty = _r2(Math.min(C.joinMax, out.penalty));
        return out;
    },

    /**
     * Lines for the free-talk character sheet (systems/npcChatImpact.js personaLines):
     * the kin of one lost with the player speak of it; the town's whisper reaches
     * everyone else. folk/p: the speaker's roster and person.
     */
    personaLines(world, player, folk, p) {
        const lines = [];
        if (!world || !player || !folk || !p || !player.vanishings) return lines;
        const P = Vanishings.data().persona || {};
        const pName = player.name || 'the traveller';
        const recs = Vanishings.fromTown(player, folk.q, folk.r);
        if (!recs.length) return lines;
        const mine = new Map();
        for (const e of p.nm || []) if (KINDS.includes(e.k) && e.vr) mine.set(e.vn, e);
        let kinLines = 0;
        for (const rec of recs) {
            const e = mine.get(rec.name);
            if (e && kinLines < 2) {
                kinLines++;
                const vars = { vr: e.vr, vn: rec.name.split(' ')[0], player: pName, when: Townsfolk.when(rec.d, world), how: Vanishings.howText(rec) };
                lines.push(_fill(rec.told != null && rec.how !== 'unknown' ? P.lost : P.lostNoHow, vars));
                lines.push(_fill(rec.told != null ? P.told : P.untold, vars));
                lines.push(_fill(P[rec.tier] || '', vars));
            } else if (!e && rec.tier !== 'grief' && kinLines === 0 && lines.length < 2) {
                lines.push(_fill(rec.tier === 'foul' ? P.town : P.townDoubt, { vn: rec.name, player: pName }));
            }
        }
        return lines.filter(Boolean);
    },

    serialize(player) {
        return player && player.vanishings ? JSON.parse(JSON.stringify(player.vanishings)) : null;
    },
};
