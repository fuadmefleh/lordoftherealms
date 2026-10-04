// ============================================
// COMPANIONS — travel companions with a life of their own
// ============================================
// The travel party (player.travelParty → Relationships NPCs) used to be a list
// of stat sticks. Each companion now has:
//
//   • Values (1–2 of honour, piety, greed, compassion, ambition, freedom,
//     loyalty to their homeland or to the faith) and an approval score toward
//     the player. Approval reacts to what the player does: Traits deed
//     counters and newly earned traits, court rulings (petition court axes),
//     quest-stat events (piracy, conquest, pilgrimage…), karma swings,
//     homeland reputation, battles won or lost and wages paid or unpaid.
//     Companions comment in short lines (notices drained by the HUD).
//   • A mood tier that scales their role bonus (PlayerEffects.companionBonus).
//     Low approval brings gripes, raise demands, desertion and — rarely, after
//     a warning — betrayal (theft, or selling the player's position to a rival
//     House or a hostile realm).
//   • A background personal quest, offered at high approval and run through
//     the ordinary quest machinery (counter_since objectives in player.quests).
//     Finishing it makes the companion devoted, with a permanent perk.
//   • Bonds: companions who travel together long enough become friends or
//     rivals, nudging their effectiveness. A companion can fall in battle and
//     be mourned in the House chronicle.
//
// Deeds are observed by diffing counters other systems already keep (no
// subscriptions needed): player.traits.deeds / .earned, player.karma,
// player.quests.stats, player.petitions history and player.reputation. Each
// day's diff is compared against a snapshot kept in player.companions.snap.
//
// Personalities are generated deterministically from a hash of the
// companion's id (no RNG), so old saves backfill identically. Randomness
// (desertion, betrayal, death in battle) flows through Utils and is only drawn
// while someone is actually travelling with the player.
//
// Content: data/companions.json (read lazily through DataLoader.companions).

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Relationships } from './relationships.js';
import { Traits } from './traits.js';
import { Quests } from './quests.js';
import { House } from './house.js';
import { Schemes } from './schemes.js';

const FALLBACK = {
    config: {
        startApproval: 55, valueCountWeights: [0.45, 0.55], maxDailySwing: 12, commentThreshold: 3,
        karmaSwingMin: 2, karmaPerApproval: 0.5, reputationPerApproval: 0.25,
        payInterval: 7, unpaidPenalty: 8, paidGreedBonus: 1,
        talkApproval: 2, talkCooldown: 1, giftCost: 40, giftApproval: 6, giftGreedBonus: 3, giftCooldown: 3,
        raiseFactor: 1.5, raiseGrantApproval: 12, raiseIgnoreDays: 10, raiseIgnorePenalty: 8,
        complainEvery: 6, questUnlockApproval: 70, questMinDays: 7, questApprovalOnAccept: 4,
        leaveApproval: 20, leaveChance: 0.08, betrayApproval: 12, betrayWarnDays: 3, betrayChance: 0.12,
        betrayStealFraction: 0.2, betrayStealMax: 400, betrayFeud: 20, betrayReputation: -10,
        bondDays: 20, bondEffect: 0.05, deathChanceWin: 0.01, deathChanceLoss: 0.03, deathFighterMult: 1.5,
        mournFriendPenalty: 5, devotedApproval: 100, noticeCap: 30, mournedCap: 12,
    },
    tiers: [
        { id: 'mutinous', label: 'Mutinous', icon: '😠', min: 0, effectiveness: 0.6 },
        { id: 'disgruntled', label: 'Disgruntled', icon: '😒', min: 25, effectiveness: 0.8 },
        { id: 'content', label: 'Content', icon: '🙂', min: 40, effectiveness: 1.0 },
        { id: 'loyal', label: 'Loyal', icon: '😊', min: 75, effectiveness: 1.25 },
        { id: 'devoted', label: 'Devoted', icon: '💛', min: 101, effectiveness: 1.5 },
    ],
    wages: { default: 2 },
    values: { honour: { label: 'Honour', icon: '🛡️', deeds: {}, traits: {}, stats: {}, court: {}, karmaWeight: 0.5, battle: { win: 1, loss: -1 } } },
    valueWeights: { default: { honour: 1 } },
    conflicts: [],
    lines: {},
    perks: {},
    kin: ['brother'],
    foes: ['a nameless foe'],
    heirlooms: ['a family heirloom'],
    questTemplates: {},
};

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

/** Unsigned 32-bit hash of a string (deterministic personality picks). */
function _hash(str) {
    return Utils.hashStr(String(str)) >>> 0;
}

/** Deterministic pick from an array keyed by a string. */
function _pick(arr, key) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr[_hash(key) % arr.length];
}

/** Deterministic weighted pick from { id: weight } keyed by a string. */
function _weighted(weights, key, exclude = []) {
    const entries = Object.entries(weights).filter(([id, w]) => w > 0 && !exclude.includes(id));
    if (!entries.length) return null;
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = (_hash(key) % 10000) / 10000 * total;
    for (const [id, w] of entries) {
        roll -= w;
        if (roll < 0) return id;
    }
    return entries[entries.length - 1][0];
}

function _cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export const Companions = {
    // ──────────── DATA ────────────

    data() {
        return (DataLoader && DataLoader.companions) || FALLBACK;
    },

    config() {
        return { ...FALLBACK.config, ...(Companions.data().config || {}) };
    },

    values() {
        return Companions.data().values || FALLBACK.values;
    },

    tiers() {
        return Companions.data().tiers || FALLBACK.tiers;
    },

    perks() {
        return Companions.data().perks || {};
    },

    templates() {
        return Companions.data().questTemplates || {};
    },

    lines(kind, sub = null) {
        const l = Companions.data().lines || {};
        const node = l[kind];
        if (sub) return (node && node[sub]) || [];
        return Array.isArray(node) ? node : [];
    },

    // ──────────── STATE ────────────

    _blank() {
        return { snap: null, notices: [], bonds: {}, mourned: [], lastPayDay: null, stats: { betrayals: 0, deserted: 0, fallen: 0, devoted: 0 } };
    },

    /** Get (creating/backfilling) the player's companion bookkeeping. */
    getState(player) {
        if (!player) return null;
        if (!player.companions || typeof player.companions !== 'object' || Array.isArray(player.companions)) {
            player.companions = Companions._blank();
        }
        const st = player.companions;
        const blank = Companions._blank();
        if (!Array.isArray(st.notices)) st.notices = [];
        if (!st.bonds || typeof st.bonds !== 'object') st.bonds = {};
        if (!Array.isArray(st.mourned)) st.mourned = [];
        if (st.snap === undefined) st.snap = null;
        if (st.lastPayDay === undefined) st.lastPayDay = null;
        st.stats = { ...blank.stats, ...(st.stats || {}) };
        return st;
    },

    /**
     * Backfill after loading a save: companion bookkeeping, and a personality
     * for every travelling companion that predates this system (generated
     * deterministically from the companion's id).
     */
    loadState(player) {
        if (!player) return null;
        const st = Companions.getState(player);
        const npcs = Array.isArray(player._relationshipNpcs) ? player._relationshipNpcs : [];
        const party = Array.isArray(player.travelParty) ? player.travelParty : [];
        for (const npc of npcs) {
            if (npc && (party.includes(npc.id) || npc.companion)) Companions.ensure(npc);
        }
        return st;
    },

    /** Plain-data copy for the save file. */
    serialize(player) {
        return player && player.companions ? JSON.parse(JSON.stringify(player.companions)) : null;
    },

    // ──────────── PERSONALITY ────────────

    /** Deterministic personality for an NPC (hash of its id). */
    generatePersonality(npc) {
        const id = (npc && npc.id) || 'companion';
        const d = Companions.data();
        const cfg = Companions.config();
        const vw = d.valueWeights || FALLBACK.valueWeights;
        const weights = { ...(vw.default || {}) };
        const occ = vw[npc && npc.occupation];
        if (occ) for (const [k, w] of Object.entries(occ)) weights[k] = (weights[k] || 0) + w;
        // Only values that exist in data
        for (const k of Object.keys(weights)) if (!Companions.values()[k]) delete weights[k];

        const first = _weighted(weights, `${id}:v1`) || Object.keys(Companions.values())[0];
        const values = [first];
        const pTwo = (cfg.valueCountWeights && cfg.valueCountWeights[1]) || 0.5;
        if ((_hash(`${id}:vc`) % 1000) / 1000 < pTwo) {
            const conflicts = (d.conflicts || []).filter(pair => pair.includes(first)).map(pair => pair.find(v => v !== first));
            const second = _weighted(weights, `${id}:v2`, [first, ...conflicts]);
            if (second) values.push(second);
        }

        // Background: a quest template that fits the occupation / values
        const templates = Companions.templates();
        const ids = Object.keys(templates);
        const fitting = ids.filter(t => {
            const def = templates[t];
            return (def.occupations || []).includes(npc && npc.occupation)
                || (def.values || []).some(v => values.includes(v));
        });
        const background = _pick(fitting.length ? fitting : ids, `${id}:bg`);

        return {
            values,
            background: background || null,
            kin: _pick(d.kin || FALLBACK.kin, `${id}:kin`),
            foe: _pick(d.foes || FALLBACK.foes, `${id}:foe`),
            heirloom: _pick(d.heirlooms || FALLBACK.heirlooms, `${id}:heir`),
        };
    },

    /** Get (creating/backfilling) an NPC's companion record. */
    ensure(npc, world = null) {
        if (!npc) return null;
        const cfg = Companions.config();
        let c = npc.companion;
        if (!c || typeof c !== 'object') {
            c = npc.companion = {};
        }
        if (!Array.isArray(c.values) || !c.values.length || c.background === undefined) {
            const p = Companions.generatePersonality(npc);
            if (!Array.isArray(c.values) || !c.values.length) c.values = p.values;
            if (c.background === undefined) c.background = p.background;
            if (!c.kin) c.kin = p.kin;
            if (!c.foe) c.foe = p.foe;
            if (!c.heirloom) c.heirloom = p.heirloom;
        }
        if (typeof c.approval !== 'number' || !isFinite(c.approval)) c.approval = cfg.startApproval;
        if (typeof c.wage !== 'number') c.wage = Companions.baseWage(npc);
        if (typeof c.wageDue !== 'number') c.wageDue = 0;
        if (typeof c.unpaid !== 'number') c.unpaid = 0;
        if (typeof c.daysTogether !== 'number') c.daysTogether = 0;
        if (c.joinedDay === undefined) c.joinedDay = world && world.day != null ? world.day : null;
        if (c.gripe === undefined) c.gripe = null;
        if (c.quest === undefined) c.quest = null;
        if (typeof c.devoted !== 'boolean') c.devoted = false;
        if (c.perk === undefined) c.perk = null;
        if (c.warnedDay === undefined) c.warnedDay = null;
        if (c.lastTalkDay === undefined) c.lastTalkDay = null;
        if (c.lastGiftDay === undefined) c.lastGiftDay = null;
        if (c.lastComplaintDay === undefined) c.lastComplaintDay = null;
        if (!Array.isArray(c.log)) c.log = [];
        return c;
    },

    /** Daily wage by occupation, scaled by how much the companion's values care about coin. */
    baseWage(npc) {
        const wages = Companions.data().wages || FALLBACK.wages;
        const base = _num(wages[npc && npc.occupation]) || _num(wages.default) || 2;
        const c = npc && npc.companion;
        const vals = (c && c.values) || [];
        let greed = 1;
        for (const v of vals) {
            const def = Companions.values()[v];
            if (def && def.wageGreed) greed = Math.max(greed, def.wageGreed);
        }
        return Math.max(1, Math.round(base * greed));
    },

    // ──────────── READ-OUTS ────────────

    /** Travelling companions (alive), each with a backfilled record. */
    members(player, world = null) {
        if (!player || !Array.isArray(player.travelParty) || player.travelParty.length === 0) return [];
        const list = Relationships.getTravelPartyMembers(player);
        for (const npc of list) Companions.ensure(npc, world);
        return list;
    },

    /** Mood tier for a companion: { id, label, icon, effectiveness }. */
    tier(npc) {
        const c = npc && npc.companion;
        const tiers = Companions.tiers().slice().sort((a, b) => a.min - b.min);
        if (c && c.devoted) return tiers.find(t => t.id === 'devoted') || tiers[tiers.length - 1];
        const approval = c ? c.approval : Companions.config().startApproval;
        let out = tiers[0];
        for (const t of tiers) {
            if (t.id === 'devoted') continue;
            if (approval >= t.min) out = t;
        }
        return out;
    },

    /** Friends minus rivals this companion has among the current party. */
    bondBalance(player, npc) {
        const st = player && player.companions;
        if (!st || !st.bonds || !npc) return 0;
        const party = Array.isArray(player.travelParty) ? player.travelParty : [];
        let n = 0;
        for (const other of party) {
            if (other === npc.id) continue;
            const b = st.bonds[Companions._bondKey(npc.id, other)];
            if (!b || !b.kind) continue;
            if (b.kind === 'friends') n++;
            else if (b.kind === 'rivals') n--;
        }
        return n;
    },

    /** Multiplier on a companion's role bonus: mood tier × bonds. */
    effectiveness(player, npc) {
        if (!npc) return 1;
        Companions.ensure(npc);
        const cfg = Companions.config();
        const base = _num(Companions.tier(npc).effectiveness) || 1;
        return Math.max(0.2, base * (1 + cfg.bondEffect * Companions.bondBalance(player, npc)));
    },

    /** A devoted companion's perk bonus for one key (power, trade, diplomacy, heal). */
    perkBonus(npc, key) {
        const c = npc && npc.companion;
        if (!c || !c.perk) return 0;
        const perk = Companions.perks()[c.perk];
        return _num(perk && perk.bonus && perk.bonus[key]);
    },

    // ──────────── APPROVAL ────────────

    _clampApproval(v) {
        return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
    },

    /** Change a companion's approval directly. Returns the new value. */
    adjust(npc, delta, reason = null, day = null) {
        const c = Companions.ensure(npc);
        if (!delta) return c.approval;
        c.approval = Companions._clampApproval(c.approval + delta);
        if (reason) {
            c.log.push({ day, delta: Math.round(delta * 10) / 10, reason });
            if (c.log.length > 8) c.log.splice(0, c.log.length - 8);
        }
        return c.approval;
    },

    _notice(player, title, text, type = 'info') {
        const st = Companions.getState(player);
        st.notices.push({ title, text, type });
        const cap = Companions.config().noticeCap;
        if (st.notices.length > cap) st.notices.splice(0, st.notices.length - cap);
    },

    /** Take queued companion notices for display: [{ title, text, type }]. */
    drainNotices(player) {
        if (!player || !player.companions || !Array.isArray(player.companions.notices)) return [];
        return player.companions.notices.splice(0);
    },

    _name(npc) {
        return npc ? `${npc.firstName}${npc.dynasty ? ` ${npc.dynasty}` : ''}` : 'A companion';
    },

    _line(lines, key, npc) {
        const l = _pick(lines, key);
        return l ? l.replace(/\{name\}/g, npc ? npc.firstName : '') : '';
    },

    // ──────────── OBSERVING THE PLAYER'S DEEDS ────────────

    /** Counters observed each day (see the module header). */
    _observe(player, world) {
        const traits = (player.traits && typeof player.traits === 'object' && !Array.isArray(player.traits)) ? player.traits : {};
        const qs = player.quests || {};
        const pet = player.petitions || {};
        return {
            deeds: { ...(traits.deeds || {}) },
            earned: Object.keys(traits.earned || {}),
            karma: _num(player.karma),
            stats: { ...(qs.stats || {}), settlements_visited: qs.settlementsVisited ? qs.settlementsVisited.size || 0 : 0 },
            court: pet.stats ? _num(pet.stats.ruled) : 0,
            reputation: { ...(player.reputation || {}) },
            day: (world && world.day) || 0,
        };
    },

    /** What changed since the last snapshot: { deeds, gained, karma, stats, rulings, reputation }. */
    _diff(player, prev, now) {
        const out = { deeds: {}, gained: [], karma: 0, stats: {}, rulings: [], reputation: {} };
        if (!prev) return out;
        for (const [k, v] of Object.entries(now.deeds)) {
            const d = _num(v) - _num(prev.deeds && prev.deeds[k]);
            if (d > 0) out.deeds[k] = d;
        }
        const before = new Set(prev.earned || []);
        out.gained = now.earned.filter(id => !before.has(id));
        out.karma = now.karma - _num(prev.karma);
        for (const [k, v] of Object.entries(now.stats)) {
            const d = _num(v) - _num(prev.stats && prev.stats[k]);
            if (d > 0) out.stats[k] = d;
        }
        const newRulings = now.court - _num(prev.court);
        if (newRulings > 0) {
            const hist = (player.petitions && player.petitions.history) || [];
            out.rulings = hist.filter(h => h.outcome === 'ruled').slice(-newRulings);
        }
        for (const [k, v] of Object.entries(now.reputation)) {
            const d = _num(v) - _num(prev.reputation && prev.reputation[k]);
            if (d) out.reputation[k] = d;
        }
        return out;
    },

    /**
     * How a companion reacts to a day's diff. Returns
     * [{ delta, reason, value }] — one entry per source that moved them.
     */
    react(npc, diff) {
        const c = Companions.ensure(npc);
        const cfg = Companions.config();
        const out = [];
        for (const v of c.values) {
            const def = Companions.values()[v];
            if (!def) continue;
            for (const [deed, n] of Object.entries(diff.deeds || {})) {
                const w = _num(def.deeds && def.deeds[deed]);
                if (w) {
                    const label = (Traits.DEEDS && Traits.DEEDS[deed] && Traits.DEEDS[deed].name) || deed;
                    out.push({ delta: w * n, reason: `your ${String(label).toLowerCase()}`, value: v });
                }
            }
            for (const t of diff.gained || []) {
                const w = _num(def.traits && def.traits[t]);
                if (w) {
                    const tdef = Traits.TRAITS && Traits.TRAITS[t];
                    out.push({ delta: w, reason: `you became ${tdef ? tdef.name : t}`, value: v });
                }
            }
            for (const [stat, n] of Object.entries(diff.stats || {})) {
                const w = _num(def.stats && def.stats[stat]);
                if (w) out.push({ delta: w * n, reason: stat.replace(/_/g, ' '), value: v });
            }
            for (const r of diff.rulings || []) {
                let d = 0;
                for (const [axis, n] of Object.entries(r.court || {})) d += _num(def.court && def.court[axis]) * _num(n);
                if (d) out.push({ delta: d, reason: `your ruling on "${r.title}"`, value: v });
            }
            if (def.karmaWeight && Math.abs(diff.karma || 0) >= cfg.karmaSwingMin) {
                out.push({ delta: diff.karma * def.karmaWeight * cfg.karmaPerApproval, reason: diff.karma > 0 ? 'a good deed' : 'a dark deed', value: v });
            }
            if (def.homelandReputation && npc.kingdomId && diff.reputation && diff.reputation[npc.kingdomId]) {
                out.push({ delta: diff.reputation[npc.kingdomId] * cfg.reputationPerApproval, reason: 'your standing with their homeland', value: v });
            }
        }
        return out.filter(r => Math.abs(r.delta) >= 0.05);
    },

    /** Apply a list of reactions to a companion (capped), with a comment when it matters. */
    _applyReactions(player, npc, reactions, day) {
        if (!reactions.length) return 0;
        const cfg = Companions.config();
        let total = reactions.reduce((s, r) => s + r.delta, 0);
        total = Math.max(-cfg.maxDailySwing, Math.min(cfg.maxDailySwing, total));
        const strongest = reactions.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
        Companions.adjust(npc, total, strongest.reason, day);
        const c = npc.companion;
        if (total <= -cfg.commentThreshold) c.lastGrievance = { day, reason: strongest.reason, value: strongest.value };
        if (Math.abs(total) >= cfg.commentThreshold) {
            const kind = total > 0 ? 'approve' : 'disapprove';
            const line = Companions._line(Companions.lines(kind, strongest.value), `${npc.id}:${day}:${kind}`, npc);
            const sign = total > 0 ? '+' : '';
            Companions._notice(player, `${total > 0 ? '👍' : '👎'} ${npc.firstName} ${total > 0 ? 'approves' : 'disapproves'}`,
                `${line} (${strongest.reason}; approval ${sign}${Math.round(total)})`, total > 0 ? 'success' : 'warning');
        }
        return total;
    },

    // ──────────── DAILY ────────────

    /**
     * A day on the road. Observes the player's deeds since yesterday and lets
     * every companion react, pays wages, grows bonds, offers and resolves
     * personal quests and plays out low-approval consequences. Returns
     * { reactions, left:[], betrayed:[], paid, unpaid }.
     */
    processDay(player, world) {
        const out = { reactions: 0, left: [], betrayed: [], paid: 0, unpaid: 0 };
        if (!player) return out;
        const st = Companions.getState(player);
        const day = (world && world.day) || 0;
        const now = Companions._observe(player, world);
        const diff = Companions._diff(player, st.snap, now);
        st.snap = now;

        // A companion who left by any road (e.g. removed from their profile)
        // takes their personal quest with them
        const party = Array.isArray(player.travelParty) ? player.travelParty : [];
        for (const npc of Relationships._npcs || []) {
            const q = npc && npc.companion && npc.companion.quest;
            if (q && q.status === 'active' && (!npc.isAlive || !party.includes(npc.id))) Companions._abandonQuest(player, npc);
        }

        const members = Companions.members(player, world);
        if (!members.length) {
            st.lastPayDay = day;
            return out;
        }
        const cfg = Companions.config();

        for (const npc of members) {
            const c = npc.companion;
            c.daysTogether++;
            const reactions = Companions.react(npc, diff);
            if (reactions.length) {
                Companions._applyReactions(player, npc, reactions, day);
                out.reactions++;
            }
        }

        Companions._payWages(player, members, day, out);
        Companions._growBonds(player, members, day);
        Companions._processQuests(player, members, world);
        Companions._consequences(player, members, world, out);
        return out;
    },

    _payWages(player, members, day, out) {
        const st = player.companions;
        const cfg = Companions.config();
        for (const npc of members) npc.companion.wageDue += npc.companion.wage;
        if (st.lastPayDay == null) st.lastPayDay = day;
        if (day - st.lastPayDay < cfg.payInterval) return;
        st.lastPayDay = day;
        for (const npc of members) {
            const c = npc.companion;
            const due = Math.round(c.wageDue);
            if (due <= 0) continue;
            if ((player.gold || 0) >= due) {
                player.gold -= due;
                if (player.financeToday && player.financeToday.expenses) {
                    player.financeToday.expenses.companions = (player.financeToday.expenses.companions || 0) + due;
                }
                c.wageDue = 0;
                c.unpaid = 0;
                if (c.gripe && c.gripe.kind === 'unpaid') c.gripe = null;
                if (c.values.includes('greed')) Companions.adjust(npc, cfg.paidGreedBonus, 'paid on time', day);
                out.paid += due;
            } else {
                c.unpaid++;
                Companions.adjust(npc, -cfg.unpaidPenalty * Math.min(3, c.unpaid), 'wages unpaid', day);
                c.gripe = { kind: 'unpaid', day, text: `Owed ${due} gold in wages.` };
                c.lastGrievance = { day, reason: 'wages unpaid', value: null };
                out.unpaid++;
                Companions._notice(player, `💸 ${npc.firstName} goes unpaid`,
                    `${Companions._line(Companions.lines('unpaid'), `${npc.id}:${day}:unpaid`, npc)} (owed ${due}g)`, 'warning');
            }
        }
    },

    _bondKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    },

    /** Values two companions hold that pull against each other. */
    _conflicting(a, b) {
        const pairs = Companions.data().conflicts || [];
        for (const va of a) {
            for (const vb of b) {
                if (pairs.some(p => (p[0] === va && p[1] === vb) || (p[0] === vb && p[1] === va))) return true;
            }
        }
        return false;
    },

    _growBonds(player, members, day) {
        const st = player.companions;
        const cfg = Companions.config();
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                const a = members[i];
                const b = members[j];
                const key = Companions._bondKey(a.id, b.id);
                const bond = st.bonds[key] || (st.bonds[key] = { days: 0, kind: null });
                bond.days++;
                if (bond.kind || bond.days < cfg.bondDays) continue;
                const va = a.companion.values;
                const vb = b.companion.values;
                const shared = va.some(v => vb.includes(v));
                let kind;
                if (shared && !Companions._conflicting(va, vb)) kind = 'friends';
                else if (Companions._conflicting(va, vb) && !shared) kind = 'rivals';
                else kind = (_hash(key) % 3 === 0) ? 'rivals' : 'friends';
                bond.kind = kind;
                bond.since = day;
                Companions._notice(player, kind === 'friends' ? '🤝 Friendship on the Road' : '⚡ Rivalry on the Road',
                    kind === 'friends'
                        ? `${a.firstName} and ${b.firstName} have become fast friends — they fight better side by side.`
                        : `${a.firstName} and ${b.firstName} can no longer stand each other — expect bickering around the fire.`,
                    kind === 'friends' ? 'success' : 'warning');
            }
        }
    },

    // ──────────── PERSONAL QUESTS ────────────

    _fill(text, npc, player) {
        const c = npc.companion || {};
        const heirloom = c.heirloom || 'a family heirloom';
        return String(text || '')
            .replace(/\{name\}/g, npc.firstName)
            .replace(/\{kinTitle\}/g, _cap(c.kin || 'kin'))
            .replace(/\{kin\}/g, c.kin || 'kin')
            .replace(/\{foe\}/g, c.foe || 'their enemy')
            .replace(/\{heirloomTitle\}/g, _cap(heirloom.replace(/^(a|an|the) /, '')))
            .replace(/\{heirloom\}/g, heirloom)
            .replace(/\{player\}/g, (player && (player.house && player.house.name)) || (player && (player.firstName || player.name)) || 'the player');
    },

    /** Quest-stat a template objective tracks (per-companion for paid objectives). */
    _objectiveStat(stat, npc) {
        return stat.startsWith('companion_') ? `${stat}_${npc.id}` : stat;
    },

    questId(npc) {
        const c = npc.companion || {};
        return `companion_${npc.id}_${c.background}`;
    },

    /** The companion's personal quest template (or null). */
    questTemplate(npc) {
        const c = npc && npc.companion;
        return (c && c.background && Companions.templates()[c.background]) || null;
    },

    /** Accept a companion's offered personal quest. Returns { success, quest?, reason? }. */
    acceptQuest(player, npcId, world = null) {
        const npc = Relationships.getNPC(npcId);
        if (!npc || !npc.isAlive) return { success: false, reason: 'They are no longer with you.' };
        const c = Companions.ensure(npc, world);
        if (!c.quest || c.quest.status !== 'offered') return { success: false, reason: 'They have nothing to ask of you yet.' };
        const def = Companions.questTemplate(npc);
        if (!def) return { success: false, reason: 'They have nothing to ask of you.' };
        if (!player.quests) Quests.initialize(player);
        if (player.quests.active.length >= 5) return { success: false, reason: 'Too many active quests (max 5)' };
        const id = Companions.questId(npc);
        const quest = {
            id,
            title: `${def.icon || '🧭'} ${Companions._fill(def.title, npc, player)}`,
            description: Companions._fill(def.description, npc, player),
            type: 'companion_quest',
            giver: { id: npc.id, name: Companions._name(npc) },
            objectives: (def.objectives || []).map(o => {
                const stat = Companions._objectiveStat(o.stat, npc);
                return {
                    type: 'counter_since', stat, baseline: Quests._counter(player, stat),
                    target: o.target, current: 0, text: Companions._fill(o.text, npc, player),
                };
            }),
            rewards: { ...(def.rewards || {}) },
            difficulty: 'medium',
            status: 'active',
            startedDay: (world && world.day) || 0,
        };
        player.quests.active.push(quest);
        c.quest = { status: 'active', questId: id, startedDay: quest.startedDay };
        Companions.adjust(npc, Companions.config().questApprovalOnAccept, 'you took up their cause', quest.startedDay);
        return { success: true, quest };
    },

    /** Pay gold toward a companion quest objective (debts, charity). */
    contribute(player, npcId, amount, world = null) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) return { success: false, reason: 'No such companion.' };
        const c = Companions.ensure(npc, world);
        const def = Companions.questTemplate(npc);
        if (!c.quest || c.quest.status !== 'active' || !def) return { success: false, reason: 'Nothing to pay toward.' };
        const obj = (def.objectives || []).find(o => o.stat.startsWith('companion_'));
        if (!obj) return { success: false, reason: 'This cause needs deeds, not gold.' };
        const stat = Companions._objectiveStat(obj.stat, npc);
        const quest = player.quests && player.quests.active.find(q => q.id === c.quest.questId);
        const objective = quest && quest.objectives.find(o => o.stat === stat);
        const paid = objective ? Math.max(0, Quests._counter(player, stat) - (objective.baseline || 0)) : 0;
        const remaining = Math.max(0, obj.target - paid);
        const pay = Math.min(Math.max(0, Math.floor(amount)), remaining, Math.floor(player.gold || 0));
        if (pay <= 0) return { success: false, reason: remaining <= 0 ? 'Already paid in full.' : 'You have no gold to give.' };
        player.gold -= pay;
        Quests.track(player, stat, pay);
        if (obj.stat === 'companion_charity') Traits.recordDeed(player, 'generosity', pay / 50);
        return { success: true, paid: pay, remaining: remaining - pay };
    },

    _abandonQuest(player, npc) {
        const c = npc.companion;
        if (!c || !c.quest || c.quest.status !== 'active') return;
        if (player.quests && Array.isArray(player.quests.active)) {
            player.quests.active = player.quests.active.filter(q => q.id !== c.quest.questId);
        }
        c.quest.status = 'abandoned';
    },

    _processQuests(player, members, world) {
        const cfg = Companions.config();
        const day = (world && world.day) || 0;
        for (const npc of members) {
            const c = npc.companion;
            const def = Companions.questTemplate(npc);
            if (!def) continue;
            if (!c.quest && !c.devoted && c.approval >= cfg.questUnlockApproval && c.daysTogether >= cfg.questMinDays) {
                c.quest = { status: 'offered', day };
                Companions._notice(player, `${def.icon || '🧭'} ${npc.firstName} has something to ask`,
                    `${npc.firstName} trusts you enough to share a personal matter — "${Companions._fill(def.title, npc, player)}". Hear them out from the Travel Party roster.`, 'info');
            } else if (c.quest && c.quest.status === 'active') {
                const done = player.quests && (player.quests.completed || []).some(q => q.id === c.quest.questId);
                if (done) Companions._devote(player, npc, def, world);
            }
        }
    },

    _devote(player, npc, def, world) {
        const c = npc.companion;
        const cfg = Companions.config();
        c.quest.status = 'done';
        c.quest.doneDay = (world && world.day) || 0;
        c.devoted = true;
        c.perk = def.perk || null;
        c.approval = cfg.devotedApproval;
        c.gripe = null;
        c.warnedDay = null;
        Companions.getState(player).stats.devoted++;
        const perk = c.perk && Companions.perks()[c.perk];
        Companions._notice(player, `💛 ${npc.firstName} is Devoted`,
            `With "${Companions._fill(def.title, npc, player)}" behind them, ${npc.firstName} is yours to the end.${perk ? ` Perk: ${perk.icon} ${perk.name} (${perk.text}).` : ''}`, 'success');
        if (player.house && def.chronicle) {
            House._chronicle(player.house, world, Companions._fill(def.chronicle, npc, player), ['companion', 'devoted']);
        }
        const rel = Relationships.getRelationship(player, npc.id);
        if (rel) rel.score = Math.min(100, (rel.score || 0) + 10);
    },

    // ──────────── LOW APPROVAL ────────────

    _grievanceText(c) {
        if (c.lastGrievance && c.lastGrievance.reason) return `Unhappy about ${c.lastGrievance.reason}.`;
        return 'Unhappy with how things are going.';
    },

    _consequences(player, members, world, out) {
        const cfg = Companions.config();
        const day = (world && world.day) || 0;
        for (const npc of members) {
            const c = npc.companion;
            if (c.devoted) continue;
            const greedy = c.values.includes('greed') || c.values.includes('ambition');

            // Recovered: forget gripes and warnings
            if (c.approval >= 40) {
                if (c.gripe && c.gripe.kind !== 'unpaid') c.gripe = null;
                c.warnedDay = null;
                continue;
            }

            // Raise demands — ignored too long, they sour further
            if (c.gripe && c.gripe.kind === 'raise' && day - c.gripe.day >= cfg.raiseIgnoreDays) {
                Companions.adjust(npc, -cfg.raiseIgnorePenalty, 'raise ignored', day);
                c.gripe = { ...c.gripe, day };
            }

            // Complaints
            if (!c.gripe || c.gripe.kind === 'deeds') {
                if (greedy && c.approval < 30 && (!c.gripe || c.gripe.kind !== 'raise')) {
                    const demand = Math.max(c.wage + 1, Math.round(c.wage * cfg.raiseFactor));
                    c.gripe = { kind: 'raise', day, demand, text: `Demands a raise to ${demand} gold a day.` };
                    Companions._notice(player, `💰 ${npc.firstName} demands a raise`,
                        `"I'm worth more than ${c.wage} a day, and we both know it." ${npc.firstName} wants ${demand} gold a day (grant it from the Travel Party roster).`, 'warning');
                } else if (!c.gripe) {
                    c.gripe = { kind: 'deeds', day, text: Companions._grievanceText(c) };
                }
            }
            if (c.lastComplaintDay == null || day - c.lastComplaintDay >= cfg.complainEvery) {
                c.lastComplaintDay = day;
                Companions._notice(player, `😒 ${npc.firstName} complains`,
                    `${Companions._line(Companions.lines('complain'), `${npc.id}:${day}:complain`, npc)} ${c.gripe ? c.gripe.text : ''}`.trim(), 'warning');
            }

            // Betrayal: only after a warning, and only from the mercenary-hearted
            if (c.approval < cfg.betrayApproval && greedy) {
                if (c.warnedDay == null) {
                    c.warnedDay = day;
                    Companions._notice(player, `⚠️ Something is wrong with ${npc.firstName}`,
                        Companions._line(Companions.lines('warning'), `${npc.id}:warn`, npc)
                            || `${npc.firstName} has been acting strangely.`, 'error');
                    continue;
                }
                if (day - c.warnedDay >= cfg.betrayWarnDays && Utils.random() < cfg.betrayChance) {
                    out.betrayed.push(Companions.betray(player, npc, world));
                }
                continue; // a plotter bides their time rather than simply walking off
            }

            // Desertion
            if (c.approval < cfg.leaveApproval && Utils.random() < cfg.leaveChance) {
                Companions._depart(player, npc, world, 'deserted');
                out.left.push(npc.id);
            }
        }
    },

    /** A companion leaves the party (deserted / dismissed). */
    _depart(player, npc, world, how) {
        const day = (world && world.day) || 0;
        Companions._abandonQuest(player, npc);
        Relationships.removeFromTravelParty(player, npc.id);
        const c = npc.companion;
        c.leftDay = day;
        c.leftHow = how;
        c.gripe = null;
        const st = Companions.getState(player);
        if (how === 'deserted') {
            st.stats.deserted++;
            const rel = Relationships.getRelationship(player, npc.id);
            if (rel) rel.score = Math.max(-100, (rel.score || 0) - 15);
            Companions._notice(player, `🚶 ${npc.firstName} has left you`,
                `${npc.firstName} slipped away in the night. ${Companions._grievanceText(c)}`, 'error');
        }
    },

    /**
     * Betrayal: steal from the treasury, or sell the player's position to a
     * rival House (inflaming its feud and hatching a scheme) or to the realm
     * that likes the player least. The companion then vanishes.
     */
    betray(player, npc, world) {
        const cfg = Companions.config();
        const day = (world && world.day) || 0;
        const st = Companions.getState(player);
        const name = Companions._name(npc);
        let text;
        const house = player.house;
        const rivals = house && house.rivals ? Object.values(house.rivals) : [];
        const sell = (_hash(`${npc.id}:betray`) % 2 === 1) || (player.gold || 0) < 20;
        if (sell && rivals.length) {
            const rival = rivals.slice().sort((a, b) => (b.feud || 0) - (a.feud || 0) || String(a.kingdomId).localeCompare(String(b.kingdomId)))[0];
            House.accrueRivalFeud(player, world, rival.kingdomId, cfg.betrayFeud, `${npc.firstName}'s betrayal`);
            let scheme = null;
            const types = Schemes.eligibleTypes(player, world, 100);
            if (types.length) scheme = Schemes.hatch(player, world, rival, types[0]);
            text = `${name} sold word of your movements and holdings to ${rival.name}.${scheme ? ' They are plotting against you.' : ''}`;
        } else if (sell) {
            const reps = Object.entries(player.reputation || {}).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
            if (reps.length) {
                const [kId] = reps[0];
                player.reputation[kId] = (player.reputation[kId] || 0) + cfg.betrayReputation;
                const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(kId) : null;
                text = `${name} sold your position to ${k ? k.name : 'a hostile realm'}. Your standing there falls (${cfg.betrayReputation}).`;
            } else {
                text = `${name} sold what they knew of you to the highest bidder and vanished.`;
            }
        }
        if (!text) {
            const stolen = Math.min(cfg.betrayStealMax, Math.floor((player.gold || 0) * cfg.betrayStealFraction));
            player.gold = (player.gold || 0) - stolen;
            text = `${name} vanished in the night with ${stolen} gold from your purse.`;
        }
        st.stats.betrayals++;
        Companions._abandonQuest(player, npc);
        Relationships.removeFromTravelParty(player, npc.id);
        const c = npc.companion;
        c.leftDay = day;
        c.leftHow = 'betrayed';
        c.gripe = null;
        const rel = Relationships.getRelationship(player, npc.id);
        if (rel) rel.score = -60;
        Companions._notice(player, `🗡️ Betrayed by ${npc.firstName}`, text, 'error');
        if (house) House._chronicle(house, world, `${name} betrayed ${house.name}: ${text}`, ['companion', 'betrayal']);
        return { npcId: npc.id, text };
    },

    // ──────────── BATTLES ────────────

    /**
     * Hook from PlayerMilitary.combat: companions react to a battle won or
     * lost, and — with low odds — one may fall. Draws randomness only when
     * someone travels with the player. info: { enemyName, roleOf(npc) } —
     * fighters (a role with battle power) stand in the front rank.
     * Returns { fallen: [names] }.
     */
    onBattle(player, victory, info = {}, world = null) {
        const out = { fallen: [] };
        const members = Companions.members(player, world);
        if (!members.length) return out;
        const cfg = Companions.config();
        const day = (world && world.day) || (player.companions && player.companions.snap && player.companions.snap.day) || 0;
        let commented = false;
        for (const npc of members) {
            const c = npc.companion;
            let d = 0;
            for (const v of c.values) {
                const def = Companions.values()[v];
                if (def && def.battle) d += _num(victory ? def.battle.win : def.battle.loss);
            }
            if (d) Companions.adjust(npc, d, victory ? `victory over ${info.enemyName || 'the enemy'}` : `defeat by ${info.enemyName || 'the enemy'}`, day);
            if (!commented && Math.abs(d) >= 2) {
                commented = true;
                const line = Companions._line(Companions.lines(victory ? 'battleWin' : 'battleLoss'), `${npc.id}:${day}:${info.enemyName}`, npc);
                if (line) Companions._notice(player, `${victory ? '⚔️' : '🩸'} ${npc.firstName}`, line, victory ? 'success' : 'warning');
            }
        }
        // The fallen — fighters stand in the front rank
        for (const npc of members) {
            const role = typeof info.roleOf === 'function' ? info.roleOf(npc) : null;
            let chance = victory ? cfg.deathChanceWin : cfg.deathChanceLoss;
            if (role && role.power) chance *= cfg.deathFighterMult;
            if (Utils.random() < chance) {
                Companions.fall(player, npc, world, info.enemyName);
                out.fallen.push(npc.firstName);
            }
        }
        return out;
    },

    /** A companion dies (in battle). Mourned by the party and the House chronicle. */
    fall(player, npc, world, enemyName = null) {
        const cfg = Companions.config();
        const day = (world && world.day) || 0;
        const st = Companions.getState(player);
        Companions._abandonQuest(player, npc);
        Relationships.removeFromTravelParty(player, npc.id);
        npc.isAlive = false;
        npc.diedDay = day;
        const c = Companions.ensure(npc);
        c.leftHow = 'fallen';
        c.leftDay = day;
        const name = Companions._name(npc);
        st.stats.fallen++;
        st.mourned.push({ id: npc.id, name, day, enemy: enemyName || null, devoted: !!c.devoted });
        if (st.mourned.length > cfg.mournedCap) st.mourned.splice(0, st.mourned.length - cfg.mournedCap);
        // Friends grieve
        for (const other of Companions.members(player, world)) {
            const bond = st.bonds[Companions._bondKey(npc.id, other.id)];
            if (bond && bond.kind === 'friends') Companions.adjust(other, -cfg.mournFriendPenalty, `grief for ${npc.firstName}`, day);
        }
        Companions._notice(player, `🕯️ ${npc.firstName} has fallen`,
            `${name} fell${enemyName ? ` fighting ${enemyName}` : ' in battle'}. The party mourns.`, 'error');
        if (player.house) {
            House._chronicle(player.house, world,
                `${name}${c.devoted ? ', devoted companion,' : ''} fell${enemyName ? ` against ${enemyName}` : ' in battle'} at the side of ${player.house.name}, and was mourned.`,
                ['companion', 'mourning']);
        }
    },

    // ──────────── PLAYER ACTIONS (roster panel) ────────────

    /** Talk around the fire: a little approval, and you learn what's on their mind. */
    talk(player, npcId, world = null) {
        const npc = Relationships.getNPC(npcId);
        if (!npc || !npc.isAlive) return { success: false, reason: 'They are not here.' };
        const c = Companions.ensure(npc, world);
        const cfg = Companions.config();
        const day = (world && world.day) || 0;
        if (c.lastTalkDay != null && day - c.lastTalkDay < cfg.talkCooldown) {
            return { success: false, reason: `You have already talked with ${npc.firstName} today.` };
        }
        c.lastTalkDay = day;
        const tier = Companions.tier(npc);
        const kind = c.approval >= 75 || c.devoted ? 'talkHappy' : c.approval >= 40 ? 'talkContent' : 'talkUnhappy';
        const gain = c.approval >= 25 ? cfg.talkApproval : cfg.talkApproval / 2;
        Companions.adjust(npc, gain, 'a talk by the fire', day);
        const line = Companions._line(Companions.lines(kind), `${npc.id}:${day}:talk`, npc);
        const values = c.values.map(v => (Companions.values()[v] || {}).label || v).join(' and ');
        const gripe = c.gripe ? ` ${c.gripe.text}` : '';
        return { success: true, npc, tier, text: `${line} ${npc.firstName} cares about ${values}.${gripe}`.trim() };
    },

    /** A gift: costs gold, raises approval (more for the greedy). */
    gift(player, npcId, world = null) {
        const npc = Relationships.getNPC(npcId);
        if (!npc || !npc.isAlive) return { success: false, reason: 'They are not here.' };
        const c = Companions.ensure(npc, world);
        const cfg = Companions.config();
        const day = (world && world.day) || 0;
        if (c.lastGiftDay != null && day - c.lastGiftDay < cfg.giftCooldown) {
            return { success: false, reason: `You gave ${npc.firstName} a gift only recently.` };
        }
        if ((player.gold || 0) < cfg.giftCost) return { success: false, reason: `A worthy gift costs ${cfg.giftCost} gold.` };
        player.gold -= cfg.giftCost;
        c.lastGiftDay = day;
        const gain = cfg.giftApproval + (c.values.includes('greed') ? cfg.giftGreedBonus : 0);
        Companions.adjust(npc, gain, 'a gift', day);
        Traits.recordDeed(player, 'generosity', 0.5);
        return { success: true, npc, cost: cfg.giftCost, gain, text: Companions._line(Companions.lines('gift'), `${npc.id}:${day}:gift`, npc) };
    },

    /** Grant a demanded raise. */
    grantRaise(player, npcId, world = null) {
        const npc = Relationships.getNPC(npcId);
        if (!npc || !npc.isAlive) return { success: false, reason: 'They are not here.' };
        const c = Companions.ensure(npc, world);
        if (!c.gripe || c.gripe.kind !== 'raise') return { success: false, reason: `${npc.firstName} has not asked for a raise.` };
        c.wage = c.gripe.demand;
        c.gripe = null;
        Companions.adjust(npc, Companions.config().raiseGrantApproval, 'a raise', (world && world.day) || 0);
        return { success: true, npc, wage: c.wage };
    },

    /** Pay outstanding wages early (clears an 'unpaid' gripe). */
    payWages(player, npcId, world = null) {
        const npc = Relationships.getNPC(npcId);
        if (!npc || !npc.isAlive) return { success: false, reason: 'They are not here.' };
        const c = Companions.ensure(npc, world);
        const due = Math.round(c.wageDue);
        if (due <= 0) return { success: false, reason: 'Nothing is owed.' };
        if ((player.gold || 0) < due) return { success: false, reason: `You need ${due} gold.` };
        player.gold -= due;
        c.wageDue = 0;
        const wasUnpaid = c.unpaid > 0;
        c.unpaid = 0;
        if (c.gripe && c.gripe.kind === 'unpaid') c.gripe = null;
        if (wasUnpaid) Companions.adjust(npc, Companions.config().unpaidPenalty / 2, 'back pay', (world && world.day) || 0);
        return { success: true, npc, paid: due };
    },

    /** Send a companion away (their personal quest is abandoned). */
    dismiss(player, npcId, world = null) {
        const npc = Relationships.getNPC(npcId);
        if (!npc) return { success: false, reason: 'No such companion.' };
        if (!Relationships.isInTravelParty(player, npcId)) return { success: false, reason: 'Not in your travel party.' };
        Companions.ensure(npc, world);
        Companions._depart(player, npc, world, 'dismissed');
        return { success: true, npc };
    },

    /** Everything the roster panel shows for one companion. */
    describe(player, npc) {
        const c = Companions.ensure(npc);
        const tier = Companions.tier(npc);
        const def = Companions.questTemplate(npc);
        let quest = null;
        if (def && c.quest) {
            const q = c.quest.status === 'active' && player.quests ? player.quests.active.find(x => x.id === c.quest.questId) : null;
            quest = {
                status: c.quest.status,
                title: Companions._fill(def.title, npc, player),
                icon: def.icon || '🧭',
                description: Companions._fill(def.description, npc, player),
                objectives: q ? q.objectives.map(o => ({ text: o.text, current: o.current || 0, target: o.target })) : [],
                payable: !!(def.objectives || []).find(o => o.stat.startsWith('companion_')),
            };
        }
        const bonds = [];
        const st = player.companions || {};
        for (const other of (player.travelParty || [])) {
            if (other === npc.id) continue;
            const b = st.bonds && st.bonds[Companions._bondKey(npc.id, other)];
            const o = Relationships.getNPC(other);
            if (b && b.kind && o) bonds.push({ name: o.firstName, kind: b.kind });
        }
        return {
            id: npc.id,
            name: Companions._name(npc),
            approval: Math.round(c.approval),
            tier,
            values: c.values.map(v => ({ id: v, ...(Companions.values()[v] || { label: v, icon: '' }) })),
            gripe: c.gripe,
            warned: c.warnedDay != null,
            wage: c.wage,
            wageDue: Math.round(c.wageDue),
            quest,
            devoted: c.devoted,
            perk: c.perk ? { id: c.perk, ...(Companions.perks()[c.perk] || {}) } : null,
            bonds,
            effectiveness: Companions.effectiveness(player, npc),
            daysTogether: c.daysTogether,
        };
    },
};
