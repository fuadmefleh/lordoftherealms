// ============================================
// INNER MAP OVERHEARD — townsfolk talking about the player, within earshot
// ============================================
// The street map's half of systems/overheard.js. Two townsfolk who stop to
// chat (world/innerMap/townLife.js _startChat) call InnerMap._overhearChat
// first: when the player is within earshot (config radius), past the cooldown
// and the town's daily allowance, and the hash roll says so, one of them says
// something about the player instead of the small talk — in one to three
// bubbles over their head (npc._bark, drawn by ui/innerMapReactions.js), and
// the other answers. The line goes into the message log; talk against the
// player is told as a notice naming who is spreading it (and from whom they
// had it), and the speaker is marked so the free talk knows they were heard.
//
// Also notes the street fights the player broke up or waded into
// (ui/innerMapBrawls.js fights) on the town's record, for the town to talk of.
//
// Rolls are hashes of the seed, the town, the day and a count, never the
// shared RNG. The model's retelling (systems/llmProse.js) is asked for only
// when it is idle, rarely, and used the next time the same thing is said.

import { InnerMap } from '../world/innerMap.js';
import { Overheard, overheardFrac } from '../systems/overheard.js';
import { Brawls } from '../systems/brawls.js';
import { LlmProse } from '../systems/llmProse.js';
import { InnerMapBrawls } from './innerMapBrawls.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

export const InnerMapOverheard = {
    _game: null,
    _nextAt: 0,
    _n: 0,
    // bubbles still to come: [{ npc, text, at, secs }]
    _queue: [],
    // fights already noted: WeakSet of fight objects
    _noted: new WeakSet(),

    _town() {
        const ref = InnerMap._currentWorldTileRef;
        return ref && ref.settlement && ref.settlement.folk ? ref.settlement : null;
    },

    /** Each frame: the bubbles queued come up in turn; fights the player was in are noted. */
    update(dt, game) {
        this._game = game || null;
        if (!InnerMap.active) { this._queue = []; return; }
        const now = _now();
        if (this._queue.length) {
            const left = [];
            for (const b of this._queue) {
                if (now < b.at) { left.push(b); continue; }
                if (b.npc && b.npc.state !== 'gone' && !b.npc._fight) b.npc._bark = { text: b.text, until: now + b.secs * 1000 };
            }
            this._queue = left;
        }
        this._noteFights(game);
    },

    _noteFights(game) {
        const s = this._town();
        const fights = InnerMapBrawls && Array.isArray(InnerMapBrawls._fights) ? InnerMapBrawls._fights : [];
        if (!s || !fights.length) return;
        for (const F of fights) {
            const fight = F && F.fight;
            if (!fight || this._noted.has(fight)) continue;
            const k = F.playerJoined ? 'joined' : fight.ended && fight.ended.by === 'player' ? 'parted' : null;
            if (!k) continue;
            this._noted.add(fight);
            const a = Brawls.instigatorOf(fight);
            const b = Brawls.foeOf(fight);
            Overheard.noteBrawl(s, {
                k, d: _num(game && game.world && game.world.day), a: a && a.name, b: b && b.name,
                ap: a && a.pid, bp: b && b.pid, place: fight.place,
            });
        }
    },

    /**
     * Two folk begin a chat (a beside b, facing). → true when they talk of the player
     * (their bubbles and the log are set here), false for the usual small talk.
     */
    tryChat(a, b) {
        const game = this._game;
        if (!game || !game.player || !game.world || !a || !b || !Overheard.enabled()) return false;
        if (InnerMap._insideBuilding) return false;
        const s = this._town();
        if (!s || !a._person || !b._person) return false;
        const C = Overheard.config();
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        if (Math.min(_dist(a, me), _dist(b, me)) > _num(C.radius, 6)) return false;
        const now = _now();
        if (now < this._nextAt) return false;
        const world = game.world;
        const day = _num(world.day, 1);
        const salt = `${(world.generationParams && world.generationParams.seed) || 0}|${s.q},${s.r}|${day}|${a._person.id}|${b._person.id}|${this._n++}`;
        if (overheardFrac(`${salt}|chance`) >= _num(C.chance, 0.35)) return false;
        if (!Overheard.roomToday(s, day)) return false;
        const res = Overheard.compose({
            world, player: game.player, settlement: s, day, salt,
            a: { p: a._person, npc: a }, b: { p: b._person, npc: b },
        });
        if (!res) return false;
        Overheard.roomToday(s, day, true);
        const [lo, hi] = Array.isArray(C.cooldownSecs) ? C.cooldownSecs : [45, 90];
        this._nextAt = now + (lo + overheardFrac(`${salt}|cool`) * (hi - lo)) * 1000;

        const sp = res.speaker.npc;
        const ls = res.listener && res.listener.npc;
        const said = Overheard.voice(world, LlmProse, s, res) || res.said;
        const secs = _num(C.lineSecs, 2.8);
        const parts = Overheard.chunks(said);
        parts.forEach((text, i) => {
            if (i === 0) sp._bark = { text, until: now + secs * 1000 };
            else this._queue.push({ npc: sp, text, at: now + i * secs * 1000, secs });
        });
        if (ls && res.reply) this._queue.push({ npc: ls, text: res.reply, at: now + parts.length * secs * 1000, secs });
        const hold = (parts.length + 1) * secs + 1;
        sp.idleTimer = Math.max(_num(sp.idleTimer), hold);
        if (ls) ls.idleTimer = Math.max(_num(ls.idleTimer), hold);

        // The speaker is marked: the free talk knows the player heard them (systems/overheard.js personaLines)
        Overheard.mark(res.speaker.p, said, res.listener && res.listener.p ? res.listener.p.first : null, res.ill, day);
        const log = said === res.said ? res.log : res.log.replace(res.said, said);
        const ui = game.ui;
        if (ui) {
            const title = (Overheard.data().log || {}).title || '👂 Overheard';
            if (res.ill && C.toastIll !== false && typeof ui.showNotification === 'function') ui.showNotification(title, log, 'warning');
            else if (typeof ui._logNotification === 'function') ui._logNotification(title, log, res.frame === 'praise' ? 'success' : 'info');
        }
        return true;
    },
};

// The chat's hook (world/innerMap/townLife.js _startChat)
InnerMap._overhearChat = (a, b) => {
    try { return InnerMapOverheard.tryChat(a, b); } catch { return false; }
};
