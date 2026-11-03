// ActionMenu — the watch comes for you: a guard who saw (or was told of) a
// beating or a killing on the street map catches up with the player
// (ui/innerMapReactions.js) or is spoken to (npcDialog). Give yourself up,
// pay the fine (a beating only), run for it, or resist. A thin adapter over
// systems/streetCrime.js (watchView / answerWatch), registered with the
// choice-scene modal (./choiceScenes.js).
import { registerScene } from './choiceScenes.js';
import { StreetCrime } from '../../systems/streetCrime.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapReactions } from '../innerMapReactions.js';

registerScene('street_watch', {
    view(game, st) {
        return StreetCrime.watchView(game.player, game.world, st.incidentId, st.guardName);
    },
    act(game, st, choice) {
        const tile = game.world && game.world.getTile(game.player.q, game.player.r);
        const out = StreetCrime.answerWatch(game.player, game.world, st.incidentId, choice, tile && tile.settlement);
        if (out.invalid) return { invalid: true, notification: out.notification };
        if (out.fight) {
            InnerMapReactions.guardResists(st.guardId);
            return { notification: out.notification };
        }
        InnerMapReactions.release(st.guardId);
        if (out.jailed) {
            return {
                notification: out.notification,
                after(g) {
                    g.ui.hideCustomPanel();
                    // To the cells: into the jail map (ui/innerMapJail.js), or off the street map
                    if (typeof g.enterJailMap === 'function') {
                        g.enterJailMap().then(ok => {
                            if (!ok && InnerMap.active && typeof g.exitInnerMap === 'function') g.exitInnerMap({ force: true });
                        });
                    } else if (InnerMap.active && typeof g.exitInnerMap === 'function') g.exitInnerMap();
                    if (typeof g.ui.updateStats === 'function') g.ui.updateStats(g.player, g.world);
                },
            };
        }
        return { notification: out.notification };
    },
    abandon(game, st) {
        // Walked away from the guard: he keeps after you
        return null;
    },
});
