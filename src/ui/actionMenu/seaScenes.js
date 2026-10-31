// ActionMenu — the open sea as choice scenes (systems/pirates.js).
//
// Hunt Pirates, Turn Pirate and Explore the Waters (ActionMenu.doSeaActivity
// in houseShips.js) open a 'sea' scene: a sighting, a fight, the aftermath,
// or a sea event, phase by phase with the odds shown. Hunters and vengeful
// captains who come for you at day's end open one too (ui/game/endDay.js).
// A scene walked away from is fought out with the defaults
// (Pirates.autoResolve) — a sighting or an event simply passes.
// The Sea Rovers log (captains, havens, your infamy) is the same scene in
// its 'log' state.
import { registerScene } from './choiceScenes.js';
import { Pirates } from '../../systems/pirates.js';

registerScene('sea', {
    view(game, state) {
        return Pirates.view(game.player, game.world, state);
    },
    act(game, state, choice) {
        if (state && state.kind === 'log') return { after: (g) => g.ui.hideCustomPanel() };
        const out = Pirates.act(game.player, game.world, state, choice) || {};
        if (out.invalid) return { invalid: true, notification: out.notification };
        if (out.state) return { state: out.state };
        return { notification: out.notification, log: out.log || (state && state.log) || [] };
    },
    abandon(game, state) {
        if (!state || state.kind === 'log') return null;
        const out = Pirates.autoResolve(game.player, game.world, state);
        return out && out.notification ? { notification: out.notification } : null;
    },
});
