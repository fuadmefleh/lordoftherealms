// ============================================
// LOCKS — locked chests and desks, barred doors, and picking them
// ============================================
//
// Some of the chests and desks in other people's buildings carry a lock
// (data/skillPacks/social.json → skills.lockpicking.locks): whether a box is
// locked and how hard its lock is come from a hash of the world seed, the box
// (Containers.key) and the restock period — the same box is locked the same
// way until the period turns, when the owner has it seen to. A locked box
// shows nothing until it is picked; once picked it stays open for the
// period (player.containerLoot[key].picked, saved with the player).
//
// A lord's seat with nobody at home and no guard on the door is barred
// (world/innerMap/seats.js); its door has a lock too (locks.doors).
//
// pick(): one attempt — the chance from Lockpicking's level and the lock's
// difficulty (beyond the reach perk you won't try), minutes spent, XP either
// way (more for harder locks). A botched attempt may be heard: by onlookers,
// guards and the owner (scene from the theft scene, ui/objectActions/
// contents.js); heard → a small fine, standing lost, a caught theft on the
// Underworld record. Randomness: the attempt and the noticing draw from
// Utils.random; the lock itself from a hash.

import { Utils } from '../core/utils.js';
import { PracticeSkills } from './practiceSkills.js';
import { SocialSkills } from './socialSkills.js';
import { Containers } from './containers.js';
import { Underworld } from './underworld.js';
import { Laws } from './laws.js';
import { Ledger } from './ledger.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash01(str) {
    return (Utils.hashStr(str) >>> 0) / 4294967296;
}

const _bType = b => (b ? String(b.type || '').replace(/^player_/, '') : null);

export const Locks = {
    def() {
        return PracticeSkills.def('lockpicking') || {};
    },

    cfg() {
        const L = Locks.def().locks || {};
        return {
            types: Array.isArray(L.types) ? L.types : ['chest', 'desk'],
            default: Array.isArray(L.default) ? L.default : [2, 4, 0.4],
            byBuilding: L.byBuilding || {},
            doors: L.doors || {},
            names: Array.isArray(L.names) ? L.names : [],
        };
    },

    rules() {
        return { lockStep: 9, min: 3, max: 95, noticeBase: 0.15, perWitness: 0.12, perGuard: 0.25, owner: 0.2, noticeMax: 0.9, fine: 8, finePerDifficulty: 3, reputation: 2, ...(Locks.def().pickRules || {}) };
    },

    /** The word for a lock of difficulty d ("Sturdy"). */
    lockName(d) {
        const n = Locks.cfg().names;
        return n[Math.max(0, Math.min(n.length - 1, Math.round(d) - 1))] || `Difficulty ${d}`;
    },

    /**
     * A container's lock (ctx as Containers.key takes it), or null: only
     * boxes of the lockable types, in someone else's building.
     * → { difficulty, name }
     */
    lockOf(world, ctx) {
        if (!ctx || !PracticeSkills.def('lockpicking')) return null;
        if (Containers.access(ctx) !== 'steal' || !ctx.building) return null;
        const C = Locks.cfg();
        if (!C.types.includes(ctx.furnitureType)) return null;
        const row = C.byBuilding[_bType(ctx.building)] || C.default;
        const [lo, hi, share] = [_num(row[0], 2), _num(row[1], 4), _num(row[2], 0.4)];
        const k = `${_seed(world)}:lock:${Containers.key(ctx)}:${Containers.period(world)}`;
        if (_hash01(k) >= share) return null;
        const d = Math.max(1, Math.min(10, lo + Math.floor(_hash01(`${k}:d`) * (Math.max(lo, hi) - lo + 1))));
        return { difficulty: d, name: Locks.lockName(d) };
    },

    /** Has the player picked this box (this period)? */
    isPicked(player, world, ctx) {
        const rec = player && player.containerLoot && player.containerLoot[Containers.key(ctx)];
        return !!(rec && rec.period === Containers.period(world) && rec.picked);
    },

    /** Locked against the player right now? → the lock, or null */
    lockedBox(player, world, ctx) {
        const lock = Locks.lockOf(world, ctx);
        return lock && !Locks.isPicked(player, world, ctx) ? lock : null;
    },

    /** A barred seat's door lock (by the seat's type), or null. */
    doorLock(building) {
        const d = _num(Locks.cfg().doors[_bType(building)], 0);
        return d > 0 ? { difficulty: d, name: Locks.lockName(d) } : null;
    },

    /** The hardest lock the player will try. */
    reach(player) {
        return Math.round(SocialSkills.perk(player, 'lockpicking', 'reach') || 4);
    },

    /** Minutes an attempt takes. */
    minutes(player) {
        return Math.max(1, Math.round(SocialSkills.perk(player, 'lockpicking', 'minutes') || 15));
    },

    /** Odds of picking a lock of difficulty d (0 when beyond reach). */
    chance(player, d) {
        if (d > Locks.reach(player)) return 0;
        const R = Locks.rules();
        const pct = SocialSkills.perk(player, 'lockpicking', 'pick') - (Math.max(1, d) - 1) * R.lockStep;
        return Math.max(R.min, Math.min(R.max, pct)) / 100;
    },

    /** Odds a botched attempt is heard. scene: { witnesses, guards, ownerInside } */
    noticeChance(player, scene = {}) {
        const R = Locks.rules();
        const raw = R.noticeBase + Math.max(0, _num(scene.witnesses)) * R.perWitness
            + Math.max(0, _num(scene.guards)) * R.perGuard + (scene.ownerInside ? R.owner : 0);
        const quiet = Math.max(0, Math.min(0.9, SocialSkills.frac(player, 'lockpicking', 'quiet')));
        return Math.max(0, Math.min(R.noticeMax, raw * (1 - quiet)));
    },

    /**
     * One try at a lock of difficulty d. Draws from Utils.random (the
     * attempt; on a botch, the noticing). XP either way.
     * → { ok, noticed, beyond, minutes, chance, xp, levelUp }
     */
    attempt(player, d, scene = {}) {
        const chance = Locks.chance(player, d);
        const minutes = Locks.minutes(player);
        if (chance <= 0) return { ok: false, noticed: false, beyond: true, minutes: 0, chance: 0, xp: 0, levelUp: null };
        const X = Locks.def().xp || {};
        const ok = Utils.random() < chance;
        const noticed = !ok && Utils.random() < Locks.noticeChance(player, scene);
        const xp = ok ? _num(X.success, 6) + d * _num(X.perDifficulty, 2) : _num(X.fail, 2) + d * _num(X.failPerDifficulty, 0.5);
        const levelUp = SocialSkills.train(player, 'lockpicking', xp);
        return { ok, noticed, beyond: false, minutes, chance, xp, levelUp };
    },

    /**
     * Pick a container's lock. ctx also carries { kingdom, settlementName,
     * worldQ, worldR, ownerName }. → attempt() + { text, fine }
     */
    pickBox(player, world, ctx, scene = {}) {
        const lock = Locks.lockedBox(player, world, ctx);
        if (!lock) return { ok: true, noticed: false, text: 'It isn\'t locked.' };
        const res = Locks.attempt(player, lock.difficulty, scene);
        if (res.beyond) return { ...res, text: `A ${lock.name.toLowerCase()} lock: beyond your skill (you can try locks up to difficulty ${Locks.reach(player)}).` };
        if (res.ok) {
            const rec = Containers._record(player, world, ctx);
            rec.picked = true;
            return { ...res, text: `After ${res.minutes} minutes' work the ${lock.name.toLowerCase()} lock gives with a click.` };
        }
        if (!res.noticed) return { ...res, text: `${res.minutes} minutes at the ${lock.name.toLowerCase()} lock, and it holds. No one seems to have heard.` };
        return { ...res, ...Locks._heard(player, world, ctx, lock, 'at a lock') };
    },

    /** Pick a barred door. → attempt() + { text } (the caller lets the player in on ok). */
    pickDoor(player, world, building, ctx = {}, scene = {}) {
        const lock = Locks.doorLock(building);
        if (!lock) return { ok: false, noticed: false, text: 'There is no lock here to pick.' };
        const res = Locks.attempt(player, lock.difficulty, scene);
        const name = (building && building.name) || 'the house';
        if (res.beyond) return { ...res, text: `The door of ${name} has a ${lock.name.toLowerCase()} lock: beyond your skill (you can try locks up to difficulty ${Locks.reach(player)}).` };
        if (res.ok) return { ...res, text: `After ${res.minutes} minutes' work the lock of ${name} turns. The door swings in.` };
        if (!res.noticed) return { ...res, text: `${res.minutes} minutes at the door of ${name}, and the lock holds. No one seems to have heard.` };
        return { ...res, ...Locks._heard(player, world, { ...ctx, building }, lock, 'at the door') };
    },

    /** A botched try was heard: a fine, standing lost, a caught theft on the record. */
    _heard(player, world, ctx, lock, where) {
        const R = Locks.rules();
        const kingdom = ctx.kingdom != null ? ctx.kingdom : null;
        const law = Laws.punishment(world, kingdom);
        const fine = Math.min(_num(player.gold), Math.round((R.fine + lock.difficulty * R.finePerDifficulty) * _num(law && law.fine, 1)));
        player.gold = _num(player.gold) - fine;
        if (fine) Ledger.record(player, 'fines', -fine);
        if (kingdom != null && player.reputation) player.reputation[kingdom] = _num(player.reputation[kingdom]) - R.reputation;
        Underworld.recordCrime(player, world, 'theft', {
            kingdom, caught: true, q: ctx.worldQ, r: ctx.worldR, scale: 0.5,
            victim: { name: ctx.ownerName || (ctx.building && ctx.building.name) || 'the townsfolk', type: 'merchant', icon: '🧑' },
        });
        const rep = kingdom != null ? `, −${R.reputation} standing in the realm` : '';
        return { caught: true, fine, text: `Caught ${where}! The scrape of your picks was heard. Fined ${fine}g${rep}.` };
    },
};
