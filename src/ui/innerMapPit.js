// ============================================
// INNER MAP — the fighting pit's fence, up close
// ============================================
// The fenced ring world/pitRing.js lays by the tavern while the town's pit
// fights in the open (systems/pitFights.js). Clicking its fence or its gate
// says what is on tonight and opens the pit's panel (ActionMenu.showPit).

import { InnerMap } from '../world/innerMap.js';
import { PitRing } from '../world/pitRing.js';
import { PitFights } from '../systems/pitFights.js';
import { ActionMenu } from './actionMenu.js';

export const InnerMapPit = {
    /** Menu entries for a piece of the pit's fence at (q, r). */
    menuItems(game, q, r) {
        const tile = InnerMap.getTile(q, r);
        const obj = tile && tile.customObject;
        if (!obj || !obj.pit || !game || !game.world || !game.player) return [];
        const wt = game.world.getTile(game.player.q, game.player.r);
        const s = wt && wt.settlement;
        if (!s || !s.pit) return [];
        const day = Number.isFinite(game.world.day) ? game.world.day : 0;
        const night = PitRing.nightOf(s, day);
        const card = night.fight ? PitFights.card(game.world, s) : null;
        const next = PitRing.nextNight(s, day);
        const out = [];
        const when = card ? (card.ran ? 'tonight\'s bouts are fought' : `${card.bouts.length} bouts tonight, from dusk`)
            : next ? `the next fight night in ${next.day - day} day${next.day - day === 1 ? '' : 's'}` : 'no bouts soon';
        out.push({ type: 'disabled', label: `🥊 ${s.pit.name}: ${when}` });
        out.push({ type: 'action', action: 'pit_panel', label: 'The Fighting Pit', icon: '🥊', desc: 'The card, the book, the fighters, the bear and the birds' });
        return out;
    },

    /** Run pit_*. Returns true when it was ours. */
    handle(game, item) {
        if (!item || !/^pit_/.test(item.action || '')) return false;
        ActionMenu.showPit(game);
        return true;
    },
};
