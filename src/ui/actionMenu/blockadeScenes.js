// ActionMenu — running a blockade as a choice scene (systems/blockadeRunning.js).
//
// A voyage bound into (or out of) a port that a royal squadron holds lies
// off the harbour mouth (systems/shipVoyages.js → voyage.blockade); the
// voyage panel opens this scene (ui/actionMenu/voyage.js onVoyageDay), and
// again each day she lies off. Run past by day or by dark, be searched,
// fight (under sail on the water: ui/innerMapSeaFight.js — or at once),
// lie off a day, turn back; seen, fight, flee or strike. A fight under sail
// comes back here as the '__fought' choice. Walked away from, she lies off.
import { registerScene } from './choiceScenes.js';
import { BlockadeRunning } from '../../systems/blockadeRunning.js';
import { InnerMapSeaFight } from '../innerMapSeaFight.js';

registerScene('blockade', {
    view(game, state) {
        return BlockadeRunning.view(game.player, game.world, state);
    },
    act(game, state, choice) {
        if (choice === '__fought' && state && state._fought) {
            const out = state._fought;
            return { notification: out.notification, log: out.log || state.log || [], endDay: !!(out.endDay || state.endDay) };
        }
        if (choice === 'fight_sail') {
            return { after: (g) => { g.ui.hideCustomPanel(); InnerMapSeaFight.begin(g, { kind: 'blockade', state }); } };
        }
        const out = BlockadeRunning.act(game.player, game.world, state, choice) || {};
        if (out.invalid) return { invalid: true, notification: out.notification };
        if (out.state) return { state: out.state };
        return { notification: out.notification, log: out.log || (state && state.log) || [], endDay: !!(out.endDay || (state && state.endDay)) };
    },
    abandon() {
        return BlockadeRunning.abandon();
    },
});
