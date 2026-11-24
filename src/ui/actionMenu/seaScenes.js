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
//
// In the battle phase, "Fight her under sail" takes the fight onto the water
// (ui/innerMapSeaFight.js, systems/seaFights.js): ships closing, broadsides,
// grappling into the deck's hand-to-hand. Its end comes back here as the
// '__fought' choice (state._fought: what SeaFights.settlePirates made of it).
// The phased choices stay as they were: the quick fight.
import { registerScene } from './choiceScenes.js';
import { Pirates } from '../../systems/pirates.js';
import { Ships } from '../../systems/ships.js';
import { InnerMapSeaFight } from '../innerMapSeaFight.js';

/** Aboard your own ship on open water: a fight can be had under sail. */
function canSail(game) {
    const p = game.player;
    const tile = p && game.world ? game.world.getTile(p.q, p.r) : null;
    return !!(p && p.boardedShip != null && Ships.isWaterTile(tile));
}

registerScene('sea', {
    view(game, state) {
        const v = Pirates.view(game.player, game.world, state);
        if (v && state && state.phase === 'battle' && canSail(game)) {
            v.options.unshift({
                id: 'sail_fight', icon: '⛵', label: 'Fight her under sail', can: true, reason: '', cost: '', chance: null, odds: false,
                hint: 'Take the deck: close, rake and grapple on the water, your squadron with you. The rows below fight it out at once.',
            });
        }
        return v;
    },
    act(game, state, choice) {
        if (state && state.kind === 'log') return { after: (g) => g.ui.hideCustomPanel() };
        if (choice === '__fought' && state && state._fought) {
            const out = state._fought;
            if (out.state) return { state: out.state };
            return { notification: out.notification, log: out.log || state.log || [] };
        }
        if (choice === 'sail_fight' && state && state.phase === 'battle' && canSail(game)) {
            return { after: (g) => { g.ui.hideCustomPanel(); InnerMapSeaFight.begin(g, { kind: 'pirates', state }); } };
        }
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
