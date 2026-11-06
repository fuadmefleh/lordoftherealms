// ============================================
// SKILL-UPS — announce practised-skill level-ups queued on the player
// ============================================
// Systems that train a skill deep in the simulation (a theft, a trade, a
// day's wages to a crew, the miles walked) queue the level-up on the player
// (SocialSkills._queue / Endurance's player._skillUps); the game loop calls
// announceSkillUps each frame and it shows them. Several at once (Climbing
// and Endurance off the same climb) are told one after another, a beat
// apart, so none is folded away under the others; every one goes to the log.
// Once a second it also keeps the old flat skill numbers and the levels in
// step (SocialSkills.sync: a rise of player.skills.stealth by any system
// becomes Stealth XP).

import { SocialSkills } from '../systems/socialSkills.js';

const GAP_MS = 700;

let _lastSync = 0;
let _lastShown = -Infinity;
const _pending = [];

/** Level-up events to tell (from any queue) → told in turn by announceSkillUps */
export function queueSkillUps(ups) {
    for (const up of ups || []) if (up && up.text) _pending.push(up);
}

export function announceSkillUps(game, now = 0) {
    const player = game && game.player;
    if (!player) return;
    if (!(now - _lastSync < 1000)) {
        _lastSync = now;
        try { SocialSkills.sync(player); } catch (e) { /* a half-made player */ }
    }
    queueSkillUps(SocialSkills.drain(player));
    if (!_pending.length || !game.ui || typeof game.ui.showNotification !== 'function') return;
    if (now - _lastShown < GAP_MS && now >= _lastShown) return;
    const up = _pending.shift();
    _lastShown = now;
    game.ui.showNotification(up.heading || `${up.icon} ${up.name} Improved`, up.text, 'success');
}
