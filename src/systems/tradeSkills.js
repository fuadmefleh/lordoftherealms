// ============================================
// TRADE SKILLS — Smithing, Tanning & Weaving, Brewing and Medicine in levels
// ============================================
//
// The glue between the practised skills (systems/practiceSkills.js; the
// skills and their perks are data/skillPacks/trades.json) and the systems
// that use them:
//
//   • Crafting (player/crafting.js): the old 0..10 craft skills (smithing,
//     leatherwork, tailoring, brewing, alchemy on player.skills) are worked
//     through these levels (trades.craftSkills). An old value v converts to
//     the XP where (level - 1) + progress = v (`xpFromOld`), and is kept in
//     step after each gain (`syncOld`) so anything reading player.skills
//     still sees the craft. `migrate(player)` raises the XP to whatever the
//     old values (or an old save's single crafting rank) are worth — never
//     lowers it — so it is safe to call on every read.
//   • NPCs: `master(settlement, world, skill)` is the best hand at a skill
//     among a town's living people (systems/townsfolk.js); `physician` is a
//     town's healer (that master, or a typical one for its size);
//     `npcLevel(npc, skill)` reads any NPC's level (a companion healer);
//     `hiredBonus` is what the town's master adds to hired work.
//
// No randomness, no globals: player / world / settlement are parameters.

import { PracticeSkills } from './practiceSkills.js';
import { Townsfolk } from './townsfolk.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export const TradeSkills = {
    /** data/skillPacks/trades.json → practiceSkills.trades */
    config() {
        return _obj(PracticeSkills.config().trades);
    },

    /** The practised skill an old craft skill (player/crafting.js) is worked through, or null */
    forCraft(craftSkill) {
        const id = _obj(TradeSkills.config().craftSkills)[craftSkill];
        return id && PracticeSkills.def(id) ? id : null;
    },

    /** The practised skill a town trade (data/markets.json recipe, commissions) uses, or null */
    forTrade(trade) {
        const id = _obj(TradeSkills.config().tradeSkills)[trade];
        return id && PracticeSkills.def(id) ? id : null;
    },

    /** The practised skill a crafting station's hired hands work with (smelt → smithing), or null */
    forStation(station) {
        const id = _obj(TradeSkills.config().stationSkills)[station];
        return id && PracticeSkills.def(id) ? id : null;
    },

    /** The old craft skill ids worked through a practised skill */
    oldIds(practiceId) {
        return Object.entries(_obj(TradeSkills.config().craftSkills)).filter(([, v]) => v === practiceId).map(([k]) => k);
    },

    /** XP worth an old 0..10 craft level: (level - 1) + progress = v */
    xpFromOld(v) {
        const max = PracticeSkills.maxLevel();
        const old = Math.max(0, Math.min(max, _num(v)));
        const L = Math.min(max, Math.floor(old + 1e-9) + 1);
        if (L >= max) return PracticeSkills.xpForLevel(max);
        const frac = Math.max(0, old - (L - 1));
        return Math.round((PracticeSkills.xpForLevel(L) + frac * PracticeSkills.stepXp(L)) * 1000) / 1000;
    },

    /** A practised skill on the old 0..10 craft scale: (level - 1) + progress to the next */
    craftLevel(holder, practiceId) {
        const p = PracticeSkills.progress(holder, practiceId);
        return Math.round(Math.min(PracticeSkills.maxLevel(), (p.level - 1) + (p.max ? 1 : p.share)) * 100) / 100;
    },

    /**
     * Old craft values (player.skills.smithing …) raise the practised XP to
     * what they are worth. Idempotent; never lowers XP.
     */
    migrate(player) {
        if (!player || !player.skills || typeof player.skills !== 'object') return false;
        let moved = false;
        for (const [old, id] of Object.entries(_obj(TradeSkills.config().craftSkills))) {
            const v = player.skills[old];
            if (typeof v !== 'number' || !(v > 0) || !PracticeSkills.def(id)) continue;
            const want = TradeSkills.xpFromOld(v);
            if (want > PracticeSkills.xp(player, id) + 1e-6) {
                if (!player.practiceSkills) player.practiceSkills = {};
                player.practiceSkills[id] = want;
                moved = true;
            }
        }
        return moved;
    },

    /** Keep the old craft values in step with a practised skill (after a gain) */
    syncOld(player, practiceId) {
        if (!player) return;
        if (!player.skills || typeof player.skills !== 'object') player.skills = {};
        const v = TradeSkills.craftLevel(player, practiceId);
        for (const old of TradeSkills.oldIds(practiceId)) player.skills[old] = v;
    },

    /** Practised XP for the player at a trade; old values kept in step. → the level-up event or null */
    gain(player, practiceId, xp) {
        if (!player || !(xp > 0) || !PracticeSkills.def(practiceId)) return null;
        TradeSkills.migrate(player);
        const up = PracticeSkills.gain(player, practiceId, xp);
        TradeSkills.syncOld(player, practiceId);
        return up;
    },

    /** A skill's own xp rate (data skills.<id>.xp.<key>) */
    xpRate(practiceId, key, d = 0) {
        const def = PracticeSkills.def(practiceId);
        return _num(def && def.xp && def.xp[key], d);
    },

    // ══════════════════════════════════════════════
    // NPCs
    // ══════════════════════════════════════════════

    /**
     * The best hand at a skill among a town's living, present grown-ups (its
     * townsfolk roster) → { person, name, level, levelName, role } or null.
     */
    master(settlement, world, skill) {
        const folk = settlement && settlement.folk;
        if (!folk || !Array.isArray(folk.people) || !PracticeSkills.def(skill)) return null;
        const day = _num(world && world.day, 1);
        let best = null;
        for (const p of Townsfolk.residents(folk)) {
            if (p.role === 'child') continue;
            Townsfolk.skillsOf(folk, p, world);
            const level = PracticeSkills.level(p, skill);
            if (!best || level > best.level || (level === best.level && p.id < best.person.id)) {
                best = { person: p, level, age: Townsfolk.age(p, day) };
            }
        }
        if (!best || best.level <= 1) return null;
        return {
            person: best.person, name: Townsfolk.name(best.person), level: best.level,
            levelName: PracticeSkills.levelName(best.level), role: Townsfolk.roleTitle(best.person),
        };
    },

    /**
     * The town's physician (or a village's herbalist): its best healer by
     * Medicine, else a typical one for its size → { name, level, levelName, typical, known }.
     */
    physician(settlement, world) {
        const P = _obj(TradeSkills.config().physician);
        const typical = Math.round(_num(_obj(P.typical)[settlement && settlement.type], 5));
        const m = TradeSkills.master(settlement, world, 'medicine');
        const level = m ? Math.max(m.level, Math.max(1, typical - 2)) : typical;
        return {
            name: m ? m.name : null, role: m ? m.role : null, level, typical, known: !!m,
            levelName: PracticeSkills.levelName(level),
        };
    },

    /** How much better (or worse) a town's physician treats than a typical one for its size (quality, 0..) */
    physicianBonus(settlement, world) {
        const P = _obj(TradeSkills.config().physician);
        const doc = TradeSkills.physician(settlement, world);
        return (doc.level - doc.typical) * _num(P.perLevel, 0.03);
    },

    /** Any NPC's level at a skill (a relationship NPC, a companion): seeded from who they are, not stored */
    npcLevel(npc, skill) {
        if (!npc) return 1;
        if (npc.practiceSkills) return PracticeSkills.level(npc, skill);
        const holder = {};
        PracticeSkills.seedNpc(holder, {
            key: String(npc.id || npc.uid || npc.firstName || ''),
            role: npc.occupation || npc.role || npc.type || 'villager',
            age: _num(npc.age, 30),
        });
        return PracticeSkills.level(holder, skill);
    },

    /**
     * A healer companion's care (data ailments care.companions multiplier, < 1
     * better) scaled by their Medicine level against trades.companions.ref.
     */
    companionCare(npc, base) {
        const C = _obj(TradeSkills.config().companions);
        const b = _num(base, 1);
        if (!(b < 1)) return b;
        const ref = Math.max(1, _num(C.ref, 6));
        const L = TradeSkills.npcLevel(npc, 'medicine');
        return Math.round(Math.max(_num(C.min, 0.3), 1 - (1 - b) * (L / ref)) * 1000) / 1000;
    },

    /**
     * What the town's best hand at a skill adds to hired work's craftsmanship
     * (systems/commissions.js) → { bonus, master } (bonus 0 without a roster).
     */
    hiredBonus(settlement, world, skill) {
        const H = _obj(TradeSkills.config().hired);
        const m = skill ? TradeSkills.master(settlement, world, skill) : null;
        if (!m) return { bonus: 0, master: null };
        return { bonus: Math.round((m.level - _num(H.ref, 5)) * _num(H.perLevel, 0.25) * 100) / 100, master: m };
    },
};
