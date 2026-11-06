// ============================================
// SKILL-UPS — announce practised-skill level-ups queued on the player
// ============================================
// Systems that train a skill deep in the simulation (a theft, a trade, a
// day's wages to a crew) queue the level-up on the player
// (SocialSkills._queue); the game loop calls announceSkillUps each frame and
// it shows them. Once a second it also keeps the old flat skill numbers and
// the levels in step (SocialSkills.sync: a rise of player.skills.stealth by
// any system becomes Stealth XP).

import { SocialSkills } from '../systems/socialSkills.js';

let _lastSync = 0;

export function announceSkillUps(game, now = 0) {
    const player = game && game.player;
    if (!player) return;
    if (!(now - _lastSync < 1000)) {
        _lastSync = now;
        try { SocialSkills.sync(player); } catch (e) { /* a half-made player */ }
    }
    const ups = SocialSkills.drain(player);
    if (!ups.length || !game.ui || typeof game.ui.showNotification !== 'function') return;
    for (const up of ups) game.ui.showNotification(`${up.icon} ${up.name} Improved`, up.text, 'success');
}
