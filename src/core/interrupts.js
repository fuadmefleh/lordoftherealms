// ============================================
// INTERRUPTS — "this needs the player": the one flag a time skip stops on
// ============================================
// Any system (core, world, systems, player, ui) that wants a multi-day wait to
// stop early raises an interrupt on the world it was handed:
//
//     Interrupts.raise(world, { reason: 'A letter from the king needs an answer', icon: '✉️', source: 'courtLetters' });
//
// Raised directly today by: a crisis beginning (systems/crises.js), a nemesis
// born or striking home (systems/nemesis.js), a House quest arriving
// (systems/houseQuests.js). Everything else reaches a skip as a notice: the
// skip raises one for any serious notice (type 'error', or a title naming war
// declared, a siege, an ambush, an ultimatum, …: ui/timeSkip.js SERIOUS), and
// checks the player's own state (wounds, hunger, letters, a band near) itself.
//
// The time skip (ui/timeSkip.js) clears the queue when it starts, runs each day
// through the real ui/game/endDay.js path, and after every day `take`s the
// queue: anything in it ends the skip and is told in the digest. Outside a skip
// nothing reads the queue, so `raise` prunes what is more than a day old and
// caps its length — raising is always safe.
//
// The queue is transient: it lives on `world._interrupts` (not serialized by
// SaveLoad.serializeWorld, which lists its fields). World is passed in; no
// globals, no RNG, no import-time effects.

const MAX_KEPT = 24;

const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);

export const Interrupts = {
    /** The live queue on this world (created on first use). */
    _queue(world) {
        if (!world) return [];
        if (!Array.isArray(world._interrupts)) world._interrupts = [];
        return world._interrupts;
    },

    /**
     * Ask a time skip to stop. `info`: { reason (text), icon?, source?, priority? }
     * or a plain string. Returns the entry (null without a world).
     */
    raise(world, info) {
        if (!world) return null;
        const o = typeof info === 'string' ? { reason: info } : (info || {});
        const entry = {
            reason: String(o.reason || o.text || 'Something needs your attention'),
            icon: o.icon || '⚠️',
            source: o.source || null,
            priority: o.priority || 'high',
            day: _day(world),
        };
        const q = this._queue(world);
        // Old entries nobody took (no skip was running) are dropped
        const today = entry.day;
        for (let i = q.length - 1; i >= 0; i--) if (today - q[i].day > 1) q.splice(i, 1);
        q.push(entry);
        if (q.length > MAX_KEPT) q.splice(0, q.length - MAX_KEPT);
        return entry;
    },

    /** The entries waiting, without taking them. */
    pending(world) {
        return world && Array.isArray(world._interrupts) ? world._interrupts.slice() : [];
    },

    /** Take (and clear) every entry waiting. */
    take(world) {
        if (!world || !Array.isArray(world._interrupts) || !world._interrupts.length) return [];
        const out = world._interrupts;
        world._interrupts = [];
        return out;
    },

    /** Drop everything waiting (a skip starting afresh). */
    clear(world) {
        if (world) world._interrupts = [];
    },
};
