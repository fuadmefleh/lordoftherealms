// ============================================================
// INNER MAP — bringing in a town field's crop
// ============================================================
// A ripe wheat field or vegetable patch in town (world/townProps.js fieldCrop)
// offers two ways to its crop:
//   Help bring it in   honest work by day: the hours pass by the field's size
//                      and the farmer pays you a share of what you cut (the
//                      rest goes into the town's granary); the field lies
//                      harvested till the new year.
//   Help yourself      lift a few (or an armful) at the theft odds
//                      (systems/containers.js stealGoods): the farmer and the
//                      watch don't like it.
// Tables in data/townProps.json harvest.

import { InnerMap } from '../world/innerMap.js';
import { TownProps } from '../world/townProps.js';
import { DataLoader } from '../core/dataLoader.js';
import { Containers } from '../systems/containers.js';
import { Hotbar } from './hotbar.js';
import { containerContext, theftScene, theftAftermath } from './objectActions/contents.js';

const _cfg = () => {
    const d = (DataLoader.get && DataLoader.get('townProps')) || (DataLoader._gamedata && DataLoader._gamedata.townProps) || {};
    return d.harvest || {};
};
const _day = (game) => (game.world && game.world.day) || 1;

function _field(q, r) {
    const tile = InnerMap.getTile(q, r);
    const obj = tile && tile.customObject;
    return obj && TownProps.parseFieldId(obj.defId) ? obj : null;
}

function _hours(crop, f) {
    const H = _cfg();
    const h = f.w * f.h * (Number(H.hoursPerCell) || 0.15);
    return Math.round(Math.min(Number(H.maxHours) || 5, Math.max(Number(H.minHours) || 1, h)) * 2) / 2;
}

export const InnerMapFields = {
    /** Menu entries for a town field whose anchor is at (q, r). */
    menuItems(game, q, r) {
        const obj = _field(q, r);
        if (!obj || !game.world || !InnerMap._currentWorldTileRef || !InnerMap._currentWorldTileRef.settlement) return [];
        const crop = TownProps.fieldCrop(obj, _day(game));
        if (!crop.good) return [];
        if (!crop.ripe || crop.left <= 0) {
            return [{ type: 'disabled', label: obj.harvestYear != null && crop.kind === 'plowed' ? '🌾 Harvested for the year' : '🌱 Not ripe yet' }];
        }
        const g = Containers.good(crop.good);
        const f = TownProps.parseFieldId(obj.defId);
        const H = _cfg();
        const share = Math.max(1, Math.floor(crop.left * (Number(H.workShare) || 0.3)));
        const hours = _hours(crop, f);
        const ctx = containerContext(game, 'field', q, r);
        const scene = theftScene(game, ctx);
        const one = Containers.stealOdds(game.player, ctx, crop.good, 1, scene);
        const arm = Math.min(crop.left, 3);
        const many = Containers.stealOdds(game.player, ctx, crop.good, arm, scene);
        const items = [
            { type: 'disabled', label: `${g.icon} Ripe: about ${crop.left} ${g.name} to bring in` },
            { type: 'action', action: 'field_work', label: 'Help Bring In the Harvest', icon: '🌾', desc: `About ${hours} hours' work; the farmer pays you ${share} ${g.name}`, objAnchorQ: q, objAnchorR: r },
            { type: 'action', action: 'field_steal', qty: 1, label: `Help Yourself to 1 ${g.name}`, icon: '🤫', desc: `Theft: ${Math.round(one.chance * 100)}% chance of being caught`, objAnchorQ: q, objAnchorR: r },
        ];
        if (arm > 1) items.push({ type: 'action', action: 'field_steal', qty: arm, label: `Take an Armful (${arm})`, icon: '🤫', desc: `Theft: ${Math.round(many.chance * 100)}% chance of being caught`, objAnchorQ: q, objAnchorR: r });
        return items;
    },

    /** Carry out a field_* action. Returns true when it was one. */
    handle(game, item) {
        if (!/^field_/.test(item.action || '')) return false;
        const q = item.objAnchorQ, r = item.objAnchorR;
        const obj = _field(q, r);
        const day = _day(game);
        const crop = obj && TownProps.fieldCrop(obj, day);
        if (!crop || !crop.ripe || crop.left <= 0) {
            game.ui.showNotification('🌾 Nothing to Bring In', 'There is nothing ripe here now.', 'info');
            return true;
        }
        const g = Containers.good(crop.good);
        const player = game.player;

        if (item.action === 'field_work') {
            const H = _cfg();
            const hour = Number(InnerMap.timeOfDay) || 0;
            if (hour < (H.workFrom ?? 6) || hour >= (H.workTo ?? 19)) {
                game.ui.showNotification('🌾 Not Now', 'The harvest is brought in by daylight. Come back in the morning.', 'warning');
                return true;
            }
            const f = TownProps.parseFieldId(obj.defId);
            const hours = Math.min(_hours(crop, f), Math.max(0.5, 23.9 - hour));
            const share = Math.max(1, Math.floor(crop.left * (Number(H.workShare) || 0.3)));
            TownProps.takeFromField(obj, day, crop.left, InnerMap.tiles);
            const ref = InnerMap._currentWorldTileRef;
            TownProps.storeHarvest(ref && ref.settlement, crop.good, Math.max(0, crop.left - share));
            if (!player.inventory) player.inventory = {};
            player.inventory[crop.good] = (Number(player.inventory[crop.good]) || 0) + share;
            InnerMap.passHours(hours);
            game.ui.showNotification('🌾 Harvest In', `${hours} hours in the field, cutting and carrying it to the granary. The farmer pays you ${share} ${g.name}.`, 'success');
        } else {
            const n = Math.min(crop.left, Math.max(1, Math.floor(item.qty || 1)));
            const ctx = containerContext(game, 'field', q, r);
            const scene = theftScene(game, ctx);
            ctx.ownerName = scene.ownerName;
            const res = Containers.stealGoods(player, game.world, ctx, crop.good, n, scene);
            if (res.ok) {
                TownProps.takeFromField(obj, day, n, InnerMap.tiles);
                game.ui.showNotification('🤫 Pocketed', res.text, 'success');
            }
            if (theftAftermath(game, res, scene)) return true;
        }
        game.ui.updateStats(player, game.world);
        Hotbar.refresh();
        return true;
    },
};
