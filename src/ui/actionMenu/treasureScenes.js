// ActionMenu — choice scenes of the map-maker's trade: digging up a cache
// (systems/treasureDigs.js), stealing a map from a named owner and being
// accused of it later (systems/mapTheft.js). Thin adapters over the domain
// modules, registered with the choice-scene modal (./choiceScenes.js).
//
//   'dig'            ActionMenu.digTreasure → guardians / traps / rivals → the dig
//   'steal_map'      ActionMenu.attemptStealMap → choose the mark
//   'map_accusation' opened on arrival in a robbed owner's town (ui/game/endDay.js)
//
// The AP of Dig and Steal Maps (deferred actions) is charged on the first
// real choice, so closing the panel costs nothing.
import { ActionMenu } from './_ref.js';
import { registerScene } from './choiceScenes.js';
import { Cartography } from '../../systems/cartography.js';
import { TreasureDigs } from '../../systems/treasureDigs.js';
import { MapTheft } from '../../systems/mapTheft.js';

function _pay(game, st) {
    if (st.paid) return true;
    if (!ActionMenu.commitPendingAP(game)) return false;
    st.paid = true;
    return true;
}

const AP_REFUSED = { invalid: true, notification: { title: '⚡ Not Enough Action Points', body: 'Rest to start a new day.', type: 'error' } };

registerScene('dig', {
    view(game, st) {
        return TreasureDigs.view(game.player, game.world, st);
    },
    act(game, st, choice) {
        const free = choice === 'leave' || choice === 'yield';
        if (!free && !_pay(game, st)) return AP_REFUSED;
        const out = TreasureDigs.act(game.player, game.world, st, choice);
        if (out.state) out.state.paid = st.paid;
        return out;
    },
});

registerScene('steal_map', {
    view(game, st) {
        const tile = game.world.getTile(st.q, st.r);
        if (!tile || !tile.settlement) return null;
        const targets = MapTheft.targets(game.player, game.world, tile);
        const follow = { accuse: 'he will accuse you when you return', bounty: 'he will post a bounty', heat: 'the crown will hunt you' };
        return {
            icon: '🗡️', title: `Whose Maps? — ${tile.settlement.name}`,
            text: 'Every chart in this town belongs to someone, and someone will miss it. Choose your mark.',
            stats: [`🦹 Stealth ${Math.floor((game.player.skills && game.player.skills.stealth) || 1)}`, `🍀 Luck ${Math.round(game.player.luck || 5)}`],
            options: [
                ...targets.map(t => ({
                    id: t.id, icon: t.icon, label: t.name, chance: t.chance, can: t.can, reason: t.reason,
                    hint: `${t.label}: ~${Math.round(t.caught * 100)}% to be caught in the act; found out later, ${follow[t.followUp] || 'he remembers'}.`,
                })),
                { id: 'leave', icon: '🚶', label: 'Think better of it', hint: 'Leave the maps where they are.', chance: null, odds: false },
            ],
        };
    },
    act(game, st, choice) {
        if (choice === 'leave') return { notification: { title: 'Not Today', body: 'You leave the maps where they lie.', type: 'info' } };
        const tile = game.world.getTile(st.q, st.r);
        if (!tile) return { notification: { title: 'Gone', body: 'You are no longer there.', type: 'error' } };
        if (!_pay(game, st)) return AP_REFUSED;
        const res = MapTheft.steal(game.player, game.world, tile, choice);
        if (res.invalid) return { invalid: true, notification: { title: 'Not Possible', body: res.message, type: 'error' } };
        if (res.success) {
            for (const m of res.maps) Cartography.applyMap(game.player, m, game.world);
            return { notification: { title: '🗡️ Map Stolen!', body: `${res.message} The area has been revealed on your map.`, type: 'success' } };
        }
        if (res.caught) return { notification: { title: '🚔 Arrested!', body: res.message, type: 'error' } };
        return { notification: { title: 'Empty-Handed', body: res.message, type: 'default' } };
    },
});

registerScene('map_accusation', {
    view(game, st) {
        const g = MapTheft.grudges(game.player).find(x => x.id === st.grudgeId);
        return g ? MapTheft.accusationView(game.player, game.world, g) : null;
    },
    act(game, st, choice) {
        const out = MapTheft.answer(game.player, game.world, st.grudgeId, choice);
        return out.invalid ? { invalid: true, notification: out.notification } : { notification: out.notification };
    },
    abandon(game, st) {
        const out = MapTheft.answer(game.player, game.world, st.grudgeId, 'ignore');
        return { notification: out.notification };
    },
});

Object.assign(ActionMenu, {
    /** Dig for treasure: a choice scene (guardians, traps, rivals) over the cache. */
    digTreasure(game, tile) {
        const t = tile || game.world.getTile(game.player.q, game.player.r);
        const begun = TreasureDigs.begin(game.player, game.world, t ? t.q : game.player.q, t ? t.r : game.player.r);
        if (begun.error) {
            ActionMenu._pendingAP = null;
            game.ui.showNotification('Nothing Here', begun.error, 'default');
            return;
        }
        ActionMenu.showScene(game, 'dig', begun.state);
    },

    /** Steal a map: choose the owner to rob. */
    attemptStealMap(game, tile) {
        if (!tile || !tile.settlement) {
            ActionMenu._pendingAP = null;
            game.ui.showNotification('No Maps Here', 'There is no one here worth robbing of a map.', 'default');
            return;
        }
        ActionMenu.showScene(game, 'steal_map', { q: tile.q, r: tile.r });
    },
});

/** On arrival: a robbed map-owner in this town wants a word (ui/game/endDay.js onPlayerArrived). */
export function checkMapAccusation(game) {
    if (!game || !game.player || game.player.jailState || game._scene) return false;
    const g = MapTheft.pendingAccusation(game.player, game.world);
    if (!g) return false;
    ActionMenu.showScene(game, 'map_accusation', { grudgeId: g.id });
    return true;
}
