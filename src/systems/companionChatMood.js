// ============================================
// COMPANION CHAT MOOD — how a free talk lands with a travelling companion
// ============================================
// When a conversation (systems/npcChat.js applyActions) warms or sours a
// companion who travels with you (player.travelParty), it moves their
// approval too (systems/companions.js: the mood tier that scales their
// bonus): chatPerRegard approval a point of regard, at most chatMaxUp up or
// chatMaxDown down a talk turn (data/companions.json config). The change is
// told in the talk's notes ("😊 Mira is pleased (+2 approval)", and a new
// mood tier named), and queued as a reaction the street map shows over them
// (ui/innerMapCompanions.js: a short bubble, '+ pleased' / '− hurt'). The
// reply schema is untouched: this reads only the regard the talk already
// moved. No RNG.

import { Companions } from './companions.js';

const DEFAULTS = { chatPerRegard: 0.5, chatMaxUp: 4, chatMaxDown: 8 };
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const QUEUE_CAP = 4;

export const CompanionChatMood = {
    config() {
        const c = Companions.config() || {};
        return {
            perRegard: _num(c.chatPerRegard, DEFAULTS.chatPerRegard),
            maxUp: _num(c.chatMaxUp, DEFAULTS.chatMaxUp),
            maxDown: _num(c.chatMaxDown, DEFAULTS.chatMaxDown),
        };
    },

    /** Is this npc a companion travelling with the player now? */
    travelling(player, npc) {
        if (!player || !npc || npc.id == null || !npc.companion) return false;
        const party = Array.isArray(player.travelParty) ? player.travelParty : [];
        return party.includes(npc.id) && npc.isAlive !== false;
    },

    /** The mood word for a change: '+ pleased' / '− hurt' and kin. */
    word(delta) {
        if (delta >= 3) return 'delighted';
        if (delta > 0) return 'pleased';
        if (delta <= -5) return 'stung';
        return 'hurt';
    },

    /**
     * After a talk turn moved `net` regard with `npc`: their approval follows.
     * Pushes a note; queues a reaction. → { delta, approval, tier, tierChanged } or null.
     */
    afterTalk(player, world, npc, net, notes = null) {
        if (!net || !CompanionChatMood.travelling(player, npc)) return null;
        const cfg = CompanionChatMood.config();
        let delta = Math.round(net * cfg.perRegard * 10) / 10;
        delta = Math.max(-cfg.maxDown, Math.min(cfg.maxUp, delta));
        if (!delta) return null;
        const before = Companions.tier(npc);
        const was = Companions.ensure(npc, world).approval;
        const day = world && Number.isFinite(world.day) ? world.day : null;
        const now = Companions.adjust(npc, delta, delta > 0 ? 'a good talk' : 'harsh words', day);
        const moved = Math.round((now - was) * 10) / 10;
        if (!moved) return null;
        const after = Companions.tier(npc);
        const tierChanged = !!(before && after && before.id !== after.id);
        const word = CompanionChatMood.word(moved);
        const first = String(npc.firstName || npc.name || 'Your companion').split(' ')[0];
        const icon = moved > 0 ? (after.icon || '😊') : (after.icon || '😒');
        const sign = moved > 0 ? '+' : '−';
        const line = `${icon} ${first} is ${word} (${sign}${Math.abs(moved)} approval)${tierChanged ? ` — now ${after.label}` : ''}`;
        if (Array.isArray(notes)) notes.push({ text: line, tone: moved > 0 ? 'good' : 'bad' });
        CompanionChatMood._queue(player, { npcId: npc.id, text: `${sign} ${word}`, tone: moved > 0 ? 'good' : 'bad', line, day });
        return { delta: moved, approval: now, tier: after, tierChanged };
    },

    _queue(player, r) {
        if (!Object.prototype.hasOwnProperty.call(player, '_companionReactions')) {
            // (not saved: a bubble is of the moment)
            Object.defineProperty(player, '_companionReactions', { value: [], enumerable: false, configurable: true, writable: true });
        }
        const q = player._companionReactions;
        q.push(r);
        if (q.length > QUEUE_CAP) q.splice(0, q.length - QUEUE_CAP);
    },

    /** Take the queued reactions (for the street map's bubbles): [{ npcId, text, tone, line, day }]. */
    drainReactions(player) {
        const q = player && player._companionReactions;
        return Array.isArray(q) && q.length ? q.splice(0) : [];
    },
};
