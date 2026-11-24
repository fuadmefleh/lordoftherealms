// ============================================
// INNER MAP — the dead on show, up close
// ============================================
// A head on a spike by the gate, a gibbet cage at the crossroads, a body left
// on the gallows (world/deadDisplays.js lays them; systems/gibbets.js keeps
// whose they are). Clicking one says who it was, who put it there and how long
// ago; you may cut it down (your own: a mercy to the kin; another lord's: a
// crime against his justice, a kindness the poor and the priests remember),
// or open The Dead & Trophies.

import { InnerMap } from '../world/innerMap.js';
import { Gibbets } from '../systems/gibbets.js';
import { DeadDisplays } from '../world/deadDisplays.js';
import { CustomObjects } from '../world/customObjects.js';
import { ActionMenu } from './actionMenu.js';

export const InnerMapDisplays = {
    isDisplayDef(def) { return !!(def && /^gb_/.test(def.id || '')); },

    /** Menu entries for a display prop at its anchor (q, r). */
    menuItems(game, def, q, r) {
        if (!game || !game.player || !game.world || !InnerMapDisplays.isDisplayDef(def)) return [];
        const tile = InnerMap.getTile(q, r);
        const id = tile && tile.customObject && tile.customObject.display;
        const { player, world } = game;
        const day = Number.isFinite(world.day) ? world.day : 0;
        const d = Gibbets.standingAt(world, player.q, player.r, day).find(x => x.id === id);
        if (!d) return [{ type: 'disabled', label: '🦴 Old bones; no one remembers whose' }];
        const k = Gibbets.kind(d.kind) || {};
        const who = d.by && d.by.kind === 'player' ? 'by your order' : `by order of ${d.by ? d.by.name : 'the crown'}`;
        const age = day - (d.day || 0);
        const out = [
            { type: 'disabled', label: `${k.icon || '💀'} ${d.name}${d.crime ? `, for ${d.crime}` : ''}: ${k.short || 'on show'}, ${who}` },
            { type: 'disabled', label: `🪰 ${DeadDisplays.stage(d, day).label}: ${age} day${age === 1 ? '' : 's'} up${Gibbets.deterrence(game.world.getTile(player.q, player.r).settlement, day) < 1 ? ' · the town\'s thieves keep their heads down' : ''}` },
        ];
        out.push({
            type: 'action', action: 'gibbet_down', label: 'Cut It Down', icon: '🪓', displayId: d.id, anchorQ: q, anchorR: r,
            desc: d.by && d.by.kind === 'player' ? 'Give the body to the earth: the kin will be grateful, the fear will fade' : 'Bury what is left: the crown\'s men will not thank you (heat), the kin and the priests will',
        });
        out.push({ type: 'action', action: 'gibbet_panel', label: 'The Dead & Trophies', icon: '💀', desc: 'The bodies in your hands, the dead you have on show, your war trophies' });
        return out;
    },

    /** Run gibbet_*. Returns true when it was ours. */
    handle(game, item) {
        if (!item || !/^gibbet_/.test(item.action || '')) return false;
        if (item.action === 'gibbet_down') {
            const { player, world } = game;
            const r = Gibbets.takeDown(player, world, player.q, player.r, item.displayId);
            if (r.success) {
                if (game.ui && game.ui.showNotification) game.ui.showNotification('🪓 Cut Down', r.text, 'info');
                InnerMapDisplays._clear(item.anchorQ, item.anchorR);
            } else if (game.ui && game.ui.showNotification) game.ui.showNotification('🪓 Cut Down', r.reason, 'warning');
            return true;
        }
        ActionMenu.showGibbets(game);
        return true;
    },

    /** Take the prop off the street map now (the next laying leaves it out: its stamp has changed). */
    _clear(q, r) {
        const t = q != null ? InnerMap.getTile(q, r) : null;
        const co = t && t.customObject;
        if (!co || !/^gb_/.test(co.defId || '')) return;
        const def = CustomObjects.getDef(co.defId);
        for (const m of [...((def && def.meta) || []), ...((def && def.tiles) || [])]) {
            const ct = InnerMap.getTile(q + m.localCol, r + m.localRow);
            if (!ct) continue;
            if (ct !== t && ct.customObjectPart && ct.customObjectPart.anchorQ === q && ct.customObjectPart.anchorR === r) ct.customObjectPart = null;
            if (m.impassable && ct.subTerrain && !/rock|water|cliff|wall/.test(ct.subTerrain.id || '')) ct.subTerrain.passable = true;
        }
        t.customObject = null;
    },
};
