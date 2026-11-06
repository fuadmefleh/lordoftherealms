// ============================================
// SOCIAL SKILLS — Stealth, Lockpicking, Haggling, Persuasion, Leadership
// ============================================
//
// The glue between the levelled skills (systems/practiceSkills.js, numbers
// in data/skillPacks/social.json) and the places they are used:
//
//   • sync(player): the old flat player.skills numbers these take over
//     (stealth → Stealth, diplomacy → Persuasion, leadership → Leadership)
//     become levels the first time; afterwards any rise of the old number by
//     another system (a festival, a prison break, an odd job) is XP, and the
//     old number is kept at level + share so everything still reading it
//     (gate searches, sieges, negotiations, escapes …) works off the level.
//     (A skill may be seeded once from another old number: migrateFrom.)
//     Marker: practiceSkills._social (saved with it).
//   • level / perk / chance (a % perk as 0..1) for the player (synced first).
//   • train(player, id, xp) / trainBy(player, id, key, n) → a level-up event
//     or null; the event is also queued on the player (queued(), drained by
//     the UI each frame, ui/skillUps.js) so callers deep in the simulation
//     need not carry it back.
//   • NPCs: npcHolder / npcLevel (a townsperson's own skills, anyone else
//     seeded from who they are), merchantLevel(settlement) — the haggling of
//     a town's merchants, from a hash of the town.
//   • Haggling: hagglingBonus(player, settlement) — the price edge against
//     the merchants (PlayerEffects.tradeBonus adds it).
//
// No randomness here, no globals: callers roll and pass what they own.

import { PracticeSkills } from './practiceSkills.js';
import { Townsfolk } from './townsfolk.js';

export const SOCIAL_SKILL_IDS = ['stealth', 'lockpicking', 'haggling', 'persuasion', 'leadership'];

function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
const _r2 = v => Math.round(v * 100) / 100;

const _merchants = new WeakMap();

export const SocialSkills = {
    config() {
        const c = PracticeSkills.config().socialSkills || {};
        return {
            legacy: c.legacy || { stealth: 'stealth', diplomacy: 'persuasion', leadership: 'leadership' },
            rate: _num(c.rate, 1),
            migrateFrom: c.migrateFrom || {},
        };
    },

    /** Is the skill defined (the pack loaded)? */
    has(id) {
        return !!PracticeSkills.def(id);
    },

    /** XP that puts a holder at the old flat value v (3.4 → level 3, 40% on to 4). */
    xpForValue(v) {
        const max = PracticeSkills.maxLevel();
        const lv = Math.max(1, Math.min(max, _num(v, 1)));
        const whole = Math.floor(lv);
        const frac = whole < max ? lv - whole : 0;
        return Math.round(PracticeSkills.xpForLevel(whole) + frac * PracticeSkills.stepXp(whole));
    },

    /** The old flat number for a skill's level: level + share of the way on (10 at the top). */
    valueOf(holder, id) {
        const p = PracticeSkills.progress(holder, id);
        return p.max ? p.level : _r2(Math.min(10, p.level + p.share * 0.99));
    },

    /**
     * Keep the old flat numbers and the levels in step (see the header).
     * → [level-up events] (also queued on the player).
     */
    sync(player) {
        const out = [];
        if (!player || typeof player !== 'object' || !SocialSkills.has('stealth')) return out;
        if (!player.skills || typeof player.skills !== 'object') player.skills = {};
        if (!player.practiceSkills) player.practiceSkills = {};
        const store = player.practiceSkills;
        const first = !store._social || typeof store._social !== 'object';
        if (first) store._social = {};
        const mark = store._social;
        const C = SocialSkills.config();
        const cap = PracticeSkills.xpForLevel(PracticeSkills.maxLevel());
        for (const [old, id] of Object.entries(C.legacy)) {
            if (!SocialSkills.has(id)) continue;
            const v = _num(player.skills[old], 1);
            if (mark[old] == null) {
                store[id] = Math.min(cap, Math.max(_num(store[id]), SocialSkills.xpForValue(v)));
            } else if (v > _num(mark[old]) + 1e-6) {
                const rise = v - _num(mark[old]);
                const ev = PracticeSkills.gain(player, id, rise * C.rate * PracticeSkills.stepXp(PracticeSkills.level(player, id)));
                if (ev) out.push(ev);
            } else if (v < _num(mark[old]) - 0.5) {
                // A big drop: someone else's numbers now (an heir, a new life) — they are the measure
                store[id] = SocialSkills.xpForValue(v);
            }
            player.skills[old] = SocialSkills.valueOf(player, id);
            mark[old] = player.skills[old];
        }
        // Skills seeded once from another old number (haggling from commerce)
        for (const [id, m] of Object.entries(C.migrateFrom)) {
            if (!SocialSkills.has(id) || mark[`_${id}`] || !m) continue;
            mark[`_${id}`] = 1;
            const v = _num(player.skills[m.from], 1) * _num(m.share, 1);
            store[id] = Math.min(cap, Math.max(_num(store[id]), SocialSkills.xpForValue(v)));
        }
        for (const ev of out) SocialSkills._queue(player, ev);
        return out;
    },

    /** The mirror of one skill written back to its old number (after a gain). */
    _mirror(player, id) {
        const store = player && player.practiceSkills;
        if (!store || !store._social) return;
        for (const [old, sid] of Object.entries(SocialSkills.config().legacy)) {
            if (sid !== id) continue;
            if (!player.skills || typeof player.skills !== 'object') player.skills = {};
            player.skills[old] = SocialSkills.valueOf(player, id);
            store._social[old] = player.skills[old];
        }
    },

    /** The player's level (synced first). */
    level(player, id) {
        SocialSkills.sync(player);
        return PracticeSkills.level(player, id);
    },

    /** A perk's value for the player. */
    perk(player, id, perkId) {
        if (!SocialSkills.has(id)) return 0;
        SocialSkills.sync(player);
        return PracticeSkills.perk(player, id, perkId);
    },

    /** A % perk as a fraction (12 → 0.12). */
    frac(player, id, perkId) {
        return SocialSkills.perk(player, id, perkId) / 100;
    },

    /** XP for doing it → a level-up event or null (also queued). Keeps the old number in step. */
    train(player, id, xp) {
        if (!player || !(xp > 0) || !SocialSkills.has(id)) return null;
        SocialSkills.sync(player);
        const ev = PracticeSkills.gain(player, id, xp);
        SocialSkills._mirror(player, id);
        if (ev) SocialSkills._queue(player, ev);
        return ev;
    },

    /** XP from a skill's own table (data skills.<id>.xp.<key>) × n. */
    xpFor(id, key, n = 1) {
        const d = PracticeSkills.def(id);
        return _num(d && d.xp && d.xp[key]) * n;
    },

    trainBy(player, id, key, n = 1) {
        return SocialSkills.train(player, id, SocialSkills.xpFor(id, key, n));
    },

    // ── The announcement queue (drained by the UI: ui/skillUps.js) ──

    _queue(player, ev) {
        if (!player || !ev) return;
        if (!Object.prototype.hasOwnProperty.call(player, '_skillUps')) {
            Object.defineProperty(player, '_skillUps', { value: [], configurable: true, enumerable: false, writable: true });
        }
        player._skillUps.push(ev);
    },

    /** Take the level-ups waiting to be announced. */
    drain(player) {
        if (!player || !player._skillUps || !player._skillUps.length) return [];
        return player._skillUps.splice(0, player._skillUps.length);
    },

    // ── NPCs ─────────────────────────────────────────

    _roleOf(npc) {
        return npc._skillRole || (npc._person && npc._person.role) || (npc.deckRole ? 'sailor' : (npc.type || 'villager'));
    },

    /**
     * An NPC's skill holder: a townsperson's own (kept and grown each
     * season), anyone else seeded from who they are. Skills added after the
     * holder was seeded are seeded now (an old save's townsfolk).
     */
    npcHolder(npc, world = null) {
        if (!npc) return null;
        let holder = null;
        try { holder = Townsfolk.npcSkills(npc, world, null); } catch (e) { holder = null; }
        if (!holder) return null;
        const store = holder.practiceSkills || (holder.practiceSkills = {});
        if (SOCIAL_SKILL_IDS.some(id => store[id] == null && SocialSkills.has(id))) {
            const fresh = {};
            PracticeSkills.seedNpc(fresh, { key: `${npc.uid || npc.id || npc.fullName || npc.name || ''}|social`, role: SocialSkills._roleOf(npc), age: _num(npc.age, 30), coastal: !!npc.deckRole });
            for (const id of SOCIAL_SKILL_IDS) if (store[id] == null && SocialSkills.has(id)) store[id] = _num(fresh.practiceSkills[id]);
        }
        return holder;
    },

    npcLevel(npc, id, world = null) {
        const h = SocialSkills.npcHolder(npc, world);
        return h ? PracticeSkills.level(h, id) : 1;
    },

    /**
     * How well a town's merchants haggle: a merchant's levels seeded from a
     * hash of the town (a bigger town's are a little sharper). No RNG.
     */
    merchantLevel(settlement) {
        if (!settlement || !SocialSkills.has('haggling')) return 1;
        if (_merchants.has(settlement)) return _merchants.get(settlement);
        const holder = {};
        PracticeSkills.seedNpc(holder, { key: `market|${settlement.name || ''}|${settlement.q},${settlement.r}`, role: 'merchant', age: 40 });
        const big = { capital: 1, city: 1 }[settlement.type] || 0;
        const L = Math.min(PracticeSkills.maxLevel(), PracticeSkills.level(holder, 'haggling') + big);
        _merchants.set(settlement, L);
        return L;
    },

    // ── Haggling ─────────────────────────────────────

    /**
     * The price edge haggling wins at a settlement's market, as a fraction:
     * the level's prices perk, moved by `contest` % for each level above or
     * below the town's merchants, never below nothing.
     * → { bonus, level, merchants }
     */
    haggle(player, settlement) {
        if (!player || !SocialSkills.has('haggling')) return { bonus: 0, level: 1, merchants: 1 };
        const level = SocialSkills.level(player, 'haggling');
        const merchants = SocialSkills.merchantLevel(settlement);
        const d = PracticeSkills.def('haggling') || {};
        const pct = PracticeSkills.perk(player, 'haggling', 'prices') + _num(d.contest, 0.5) * (level - merchants);
        return { bonus: Math.max(0, pct) / 100, level, merchants };
    },

    hagglingBonus(player, settlement) {
        return SocialSkills.haggle(player, settlement).bonus;
    },

    /** Haggling XP for a deal worth `gold`. */
    tradeXp(gold) {
        const X = (PracticeSkills.def('haggling') || {}).xp || {};
        return Math.min(_num(X.max, 15), _num(X.trade, 0.5) + Math.max(0, _num(gold)) * _num(X.perGold, 0.02));
    },

    // ── Persuasion ───────────────────────────────────

    /**
     * Extra difficulty a talker of an NPC's skill adds to talking them
     * round: npcEdge a level over the usual 2 (a noble's 5 → +1.5).
     */
    npcResistance(npc, world = null) {
        if (!npc || !SocialSkills.has('persuasion')) return 0;
        const d = PracticeSkills.def('persuasion') || {};
        return Math.max(0, (SocialSkills.npcLevel(npc, 'persuasion', world) - 2) * _num(d.npcEdge, 0.5));
    },

    /** Odds of talking the watch out of an arrest (guardLevel: the guard's persuasion). */
    talkOutChance(player, guardLevel = 1) {
        const d = PracticeSkills.def('persuasion') || {};
        const c = SocialSkills.perk(player, 'persuasion', 'talkOut') - Math.max(0, guardLevel - 2) * _num(d.talkOutPerGuardLevel, 3);
        return Math.max(0.02, Math.min(0.85, c / 100));
    },
};
