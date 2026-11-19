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
// Saves are asynchronous (IndexedDB, core/saveStore.js): on leaving the page the
// write is started at once, uncompressed (SaveLoad.saveGame(game, { now: true })),
// and the save store is opened when the game starts so nothing has to wait then.

import { SaveLoad } from '../../systems/saveLoad.js';
import { MetaLegacy } from '../../systems/metaLegacy.js';

/** Save on leaving the page, once per game (Ironman only; harmless to call for any game). */
export function bindIronmanQuit(game) {
    if (!game || game._ironmanQuitBound || typeof window === 'undefined') return;
    game._ironmanQuitBound = true;
    // (open the save store now: the write on the way out cannot wait for it)
    SaveLoad._ready().catch(() => { /* saves will say so */ });
    window.addEventListener('beforeunload', () => {
        if (!SaveLoad.isIronman(game) || !game.player || !game.world) return;
        // (the Main Menu button saved and waited already: ui/ui/panels.js)
        if (game._ironmanSavedForExit) return;
        try {
            SaveLoad.saveGame(game, { now: true }).catch(() => { /* nothing more to do on the way out */ });
        } catch (err) { /* nothing more to do on the way out */ }
    });
}

/** A death in an Ironman run is written down before the deathbed shows. */
export function recordIronmanDeath(game, cause) {
    if (!SaveLoad.isIronman(game)) return;
    const run = game.world.run;
    run.deathPending = { cause: cause || null, day: game.world.day, name: game.player ? game.player.name : '' };
    SaveLoad.saveGame(game).then((res) => {
        if (res && !res.success && !res.superseded) {
            console.error('[Ironman] could not save the death', res.error);
            if (res.quota && game.ui) game.ui.showNotification('⚠️ Not saved', res.error, 'error');
        }
    });
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

/** The House is ended and the run with it: no more saves, and the slot is gone (deleted
 * in the background: a save still being written lands first, then goes, core/saveStore.js). */
export function endIronmanRun(game) {
    if (!SaveLoad.isIronman(game)) return false;
    MetaLegacy.finalize(game.world);
    SaveLoad.deleteSave(SaveLoad.IRONMAN_KEY);
    return true;
}
