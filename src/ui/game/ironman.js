// ============================================
// IRONMAN — the run's one save, kept whatever happens
// ============================================
// An Ironman run (world.run.ironman, systems/metaLegacy.js) saves itself at
// each day's end (SaveLoad.shouldAutoSave, ui/game/endDay.js) and whenever the
// page is left: the Main Menu button reloads the page, so 'beforeunload' covers
// it, a closed tab and a reload alike. A death is saved at once, with the
// deathbed still to come (world.run.deathPending), so reloading cannot undo it;
// resumeGame (ui/game/editorUI.js) opens the deathbed again. Once the run is
// over (its last epitaph) the slot is deleted and nothing saves.

import { SaveLoad } from '../../systems/saveLoad.js';
import { MetaLegacy } from '../../systems/metaLegacy.js';

/** Save on leaving the page, once per game (Ironman only; harmless to call for any game). */
export function bindIronmanQuit(game) {
    if (!game || game._ironmanQuitBound || typeof window === 'undefined') return;
    game._ironmanQuitBound = true;
    window.addEventListener('beforeunload', () => {
        if (!SaveLoad.isIronman(game) || !game.player || !game.world) return;
        try { SaveLoad.saveGame(game); } catch (err) { /* nothing more to do on the way out */ }
    });
}

/** A death in an Ironman run is written down before the deathbed shows. */
export function recordIronmanDeath(game, cause) {
    if (!SaveLoad.isIronman(game)) return;
    const run = game.world.run;
    run.deathPending = { cause: cause || null, day: game.world.day, name: game.player ? game.player.name : '' };
    try { SaveLoad.saveGame(game); } catch (err) { console.error('[Ironman] could not save the death', err); }
}

/** A day ended with someone alive at the helm: the death (if any) has been settled. */
export function settleIronmanDeath(game) {
    const run = game && game.world && game.world.run;
    if (run && run.deathPending && game.player && !game.player._isDead) run.deathPending = null;
}

/** Is a saved death still waiting for its deathbed (resume)? */
export function pendingIronmanDeath(game) {
    const run = game && game.world && game.world.run;
    const d = run && run.ironman ? run.deathPending : null;
    if (!d || !game.player) return null;
    return d.name && d.name !== game.player.name ? null : d;
}

/** The House is ended and the run with it: no more saves, and the slot is gone. */
export function endIronmanRun(game) {
    if (!SaveLoad.isIronman(game)) return false;
    MetaLegacy.finalize(game.world);
    SaveLoad.deleteSave(SaveLoad.IRONMAN_KEY);
    return true;
}
