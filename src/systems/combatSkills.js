// ============================================
// COMBAT SKILLS — Blades, Brawling, Archery and Sailing as practised skills
// ============================================
//
// The glue between the levelled skills (systems/practiceSkills.js, numbers
// in data/skillPacks/combat.json) and the places they are used:
//
//   • weaponSkill(weaponId): which skill a weapon is fought with (fists →
//     brawling, anything else → blades).
//   • sync(player): an old save's flat player.skills.combat becomes levels
//     once; afterwards any rise in the old number (training, bounties,
//     battles) feeds in as XP, and the old number is kept at least the best
//     fighting level, so everything that still reads it keeps working.
//   • level / perk / chance (perk as 0..1) for the player (synced first).
//   • train(player, id, xp) → a level-up event or null (announced by the UI).
//   • NPCs: npcHolder(npc) (a townsperson's own skills, else seeded from who
//     they are), npcLevel, npcPerk, and npcEdge — how far above or below the
//     usual for their kind they are (the duel profile shifts by it).
//
// No randomness here, no globals: callers roll and pass what they own.

import { PracticeSkills } from './practiceSkills.js';
import { Townsfolk } from './townsfolk.js';

export const COMBAT_SKILL_IDS = ['blades', 'brawling', 'archery', 'sailing'];
const FIGHT_IDS = ['blades', 'brawling', 'archery'];

function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

export const CombatSkills = {
    config() {
        const c = PracticeSkills.config().combatSkills || {};
        return {
            weaponSkill: { fists: 'brawling', ...(c.weaponSkill || {}) },
            defaultWeaponSkill: c.defaultWeaponSkill || 'blades',
            migrate: { levels: { blades: 1, brawling: 0.8, archery: 0.7 }, riseShare: { blades: 1, brawling: 0.6, archery: 0.4 }, ...(c.migrate || {}) },
            inner: { minHit: 0.3, maxHit: 0.97, npcHitBonus: 0, npcLevelWeight: 0.35, powerMult: 1.8, ...(c.inner || {}) },
            duel: { parryDefense: 0.05, parryRiposte: 0.01, powerMult: 1.75, staggerDrain: 2, ...(c.duel || {}) },
            field: { volleyWeight: 0.5, meleePerLevel: 0.01, ...(c.field || {}) },
        };
    },

    /** Is the skill defined (the pack loaded)? */
    has(id) {
        return !!PracticeSkills.def(id);
    },

    /** The skill a weapon is fought with: 'brawling' for fists, else 'blades'. */
    weaponSkill(weaponId) {
        const C = CombatSkills.config();
        return C.weaponSkill[weaponId] || (weaponId && weaponId !== 'fists' ? C.defaultWeaponSkill : 'brawling');
    },

    /** The skill for an NPC's weapon as their duel profile names it ("bare fists" → brawling). */
    npcWeaponSkill(weaponName) {
        return !weaponName || /fist/i.test(String(weaponName)) ? 'brawling' : 'blades';
    },

    /**
     * The old flat combat number and the fighting skills kept in step.
     * First touch: levels from player.skills.combat (data migrate.levels);
     * later rises of the old number feed in as XP (migrate.riseShare of a
     * level); the old number never sits below the best fighting level.
     * Marker: practiceSkills._combat (the old number last seen; saved with it).
     */
    sync(player) {
        if (!player || typeof player !== 'object' || !CombatSkills.has('blades')) return;
        const skills = player.skills && typeof player.skills === 'object' ? player.skills : null;
        const combat = skills ? _num(skills.combat, 1) : 1;
        if (!player.practiceSkills) player.practiceSkills = {};
        const store = player.practiceSkills;
        const M = CombatSkills.config().migrate;
        if (store._combat == null) {
            const cap = PracticeSkills.xpForLevel(PracticeSkills.maxLevel());
            for (const id of FIGHT_IDS) {
                if (!CombatSkills.has(id)) continue;
                const lv = Math.max(1, combat * _num(M.levels[id], 0));
                const whole = Math.min(PracticeSkills.maxLevel(), Math.floor(lv));
                const frac = whole < PracticeSkills.maxLevel() ? lv - whole : 0;
                const xp = PracticeSkills.xpForLevel(whole) + frac * PracticeSkills.stepXp(whole);
                store[id] = Math.min(cap, Math.max(_num(store[id]), Math.round(xp)));
            }
            store._combat = combat;
        } else if (combat > _num(store._combat) + 1e-6) {
            const rise = combat - _num(store._combat);
            for (const id of FIGHT_IDS) {
                const share = _num(M.riseShare[id], 0);
                if (share > 0 && CombatSkills.has(id)) {
                    PracticeSkills.gain(player, id, rise * share * PracticeSkills.stepXp(PracticeSkills.trainedLevel(player, id)));
                }
            }
            store._combat = combat;
        }
        CombatSkills._liftCombat(player);
    },

    /** Keep the old flat combat number at least the best fighting level. */
    _liftCombat(player) {
        if (!player || !player.skills || typeof player.skills !== 'object') return;
        const best = Math.max(...FIGHT_IDS.map(id => (CombatSkills.has(id) ? PracticeSkills.level(player, id) : 1)));
        if (_num(player.skills.combat, 1) < best) player.skills.combat = Math.min(10, best);
        if (player.practiceSkills) player.practiceSkills._combat = Math.max(_num(player.practiceSkills._combat), _num(player.skills.combat, 1));
    },

    /** The player's level in a skill (fighting skills synced from the old number first). */
    level(player, id) {
        if (FIGHT_IDS.includes(id)) CombatSkills.sync(player);
        return PracticeSkills.level(player, id);
    },

    /** A perk's value for the player. */
    perk(player, id, perkId) {
        if (FIGHT_IDS.includes(id)) CombatSkills.sync(player);
        return PracticeSkills.perk(player, id, perkId);
    },

    /** A perk as a chance (percent → 0..1). */
    chance(player, id, perkId) {
        return Math.max(0, Math.min(1, CombatSkills.perk(player, id, perkId) / 100));
    },

    /** XP for doing it → a level-up event or null. Keeps the old combat number in step. */
    train(player, id, xp) {
        if (!player || !(xp > 0) || !CombatSkills.has(id)) return null;
        if (FIGHT_IDS.includes(id)) CombatSkills.sync(player);
        const ev = PracticeSkills.gain(player, id, xp);
        if (ev && FIGHT_IDS.includes(id)) CombatSkills._liftCombat(player);
        return ev;
    },

    /** XP from a skill's own table (data skills.<id>.xp.<key>) × n. */
    xpFor(id, key, n = 1) {
        const d = PracticeSkills.def(id);
        return _num(d && d.xp && d.xp[key]) * n;
    },

    /** train() by a key of the skill's xp table. */
    trainBy(player, id, key, n = 1) {
        return CombatSkills.train(player, id, CombatSkills.xpFor(id, key, n));
    },

    // ── NPCs ─────────────────────────────────────────

    /**
     * An NPC's skill holder: a townsperson's own (kept and grown each
     * season), anyone else seeded from who they are (npc._skillRole wins:
     * a pit bruiser, a pirate boarder). Skills added after the holder was
     * seeded are seeded now (an old save's townsfolk).
     */
    npcHolder(npc, world = null) {
        if (!npc) return null;
        let holder = null;
        try { holder = Townsfolk.npcSkills(npc, world, null); } catch (e) { holder = null; }
        if (!holder) return null;
        const store = holder.practiceSkills || (holder.practiceSkills = {});
        if (COMBAT_SKILL_IDS.some(id => store[id] == null && CombatSkills.has(id))) {
            const fresh = {};
            const role = npc._skillRole || (npc._person && npc._person.role) || (npc.deckRole ? 'sailor' : (npc.type || 'villager'));
            PracticeSkills.seedNpc(fresh, { key: `${npc.uid || npc.id || npc.fullName || npc.name || ''}|combat`, role, age: _num(npc.age, 30), coastal: !!npc.deckRole });
            for (const id of COMBAT_SKILL_IDS) if (store[id] == null && CombatSkills.has(id)) store[id] = _num(fresh.practiceSkills[id]);
        }
        return holder;
    },

    npcLevel(npc, id, world = null) {
        const h = CombatSkills.npcHolder(npc, world);
        return h ? PracticeSkills.level(h, id) : 1;
    },

    npcPerk(npc, id, perkId, world = null) {
        return PracticeSkills.perkAt(id, perkId, CombatSkills.npcLevel(npc, id, world));
    },

    /** The level usual for an NPC of this role (base + role + half the spread). */
    usualLevel(role, id) {
        const N = PracticeSkills.config().npc || {};
        const r = (N.roles || {})[role] || {};
        return Math.max(1, Math.min(PracticeSkills.maxLevel(), _num((N.base || {})[id], 1) + _num(r[id]) + Math.max(0, N.spread | 0) / 2));
    },

    /** Levels above (+) or below (−) the usual for their kind, in skill `id`. */
    npcEdge(npc, id, world = null) {
        if (!npc || !CombatSkills.has(id)) return 0;
        const role = npc._skillRole || (npc._person && npc._person.role) || (npc.deckRole ? 'sailor' : (npc.type || 'villager'));
        return CombatSkills.npcLevel(npc, id, world) - CombatSkills.usualLevel(role, id);
    },
};
