// ============================================
// PARENTS GUARD — your parents' rules at every door, not only the action menu
// ============================================
// A child under their parents' roof (player/parentage.js) is checked when an
// action is taken from the action menu (ActionMenu.handleAction). But the same
// things can be reached other ways: a panel opened from another panel (the
// tavern's dice tables open the gambling den; Counsel opens the contracts), and
// the street map's own doings — taking from a stall, setting on someone,
// robbing a body, killing a farmer's beast. Each of those doors calls
// ParentsGuard.ok(game, type) first, with the rule's action type.
//
// The first door of a kind in a day, at a place, decides (refused when
// grounded; else defiance, and they may hear of it); going on through the same
// door that day (a panel's Back button, its next tab) asks nothing more, so
// one evening in the tavern is one defiance, not one a click.
//
// No game state of its own beyond a memo on the game object (not saved: a new
// session asks again).

import { Parentage } from '../player/parentage.js';

export const ParentsGuard = {
    /**
     * May the player go through this door? Shows the refusal or the defiance
     * notice. → true (go on) | false (refused: grounded). opts.each: a deed
     * (a theft, a blow) is weighed every time, not once a day.
     */
    ok(game, type, where = null, opts = {}) {
        const player = game && game.player;
        const world = game && game.world;
        if (!player || !world) return true;
        const pa = Parentage.state(player);
        if (!pa || !pa.active) return true;
        const at = where || player;
        const key = `${type}|${world.day}|${at.q},${at.r}`;
        if (!game._parentsSeen || game._parentsSeen.day !== world.day) game._parentsSeen = { day: world.day, keys: new Set() };
        if (!opts.each && game._parentsSeen.keys.has(key)) return true;
        const res = Parentage.onAction(player, world, type);
        if (res && res.refused) {
            if (game.ui) game.ui.showNotification('🔒 Grounded', res.text, 'error');
            return false;
        }
        if (res && res.text && game.ui) game.ui.showNotification(res.caught ? '😠 Your Parents' : '🤫 Defiance', res.text, res.caught ? 'warning' : 'info');
        if (res && !opts.each) game._parentsSeen.keys.add(key);
        return true;
    },
};
