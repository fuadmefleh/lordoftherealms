// ============================================
// INNER MAP LOTS — the menu for building lots and houses to let
// ============================================
// The UI half of world/innerMap/lots.js and systems/lots.js. On a town map:
//
//   - a lot for sale: its size and price, and Buy;
//   - the player's own lot: the build menu, its property placed within it;
//   - someone else's lot: whose it is (and what they're raising);
//   - anywhere else in town: no building — land in town goes by the lot;
//   - a vacant house: rent by the day or buy; a rented one: give it up, or buy.

import { InnerMap } from '../world/innerMap.js';
import { LotBook } from '../world/lotBook.js';
import { Lots } from '../systems/lots.js';
import { ActionMenu } from './actionMenu.js';

function _settlement(game) {
    const wt = game && game.world && game.player ? game.world.getTile(game.player.q, game.player.r) : null;
    return { wt, s: (wt && wt.settlement) || null };
}

export const InnerMapLots = {
    /** Build-menu items for a tile on a town map, or null when the tile isn't in town (the usual build menu then). */
    tileItems(game, tile, q, r) {
        const { s } = _settlement(game);
        if (!s || InnerMap._insideBuilding) return null;
        const at = InnerMap.lotAt(q, r);
        const items = [{ type: 'separator' }];
        if (!at) {
            items.push({ type: 'header', label: '🏗️ Build' });
            items.push({ type: 'disabled', label: '📜 Not for building', desc: 'Land in town goes by the lot. Look for the staked-out lots along the streets.' });
            return items;
        }
        const { lot, rec, price, mine } = at;
        if (!rec) {
            items.push({ type: 'header', label: `📜 Building Lot — ${lot.w}×${lot.h}` });
            items.push({ type: 'action', action: 'lot_buy', label: `Buy this Lot (${price}g)`, icon: '💰', desc: 'Yours to build on, within its stakes', lot });
            return items;
        }
        if (mine) {
            items.push({ type: 'header', label: `📜 Your Lot — ${lot.w}×${lot.h}` });
            if (rec.built) {
                items.push({ type: 'disabled', label: `🏠 ${rec.built.name || 'Your building'} stands here` });
            } else {
                items.push({ type: 'action', action: 'lot_build', label: 'Build on this Lot', icon: '🏗️', desc: 'A farm, workshop, shop, tavern... within the lot', lot });
            }
            return items;
        }
        items.push({ type: 'header', label: '📜 A Sold Lot' });
        const what = rec.built && rec.built.type ? ` — a ${String(rec.built.type).replace(/_/g, ' ')} going up` : '';
        items.push({ type: 'disabled', label: `👤 ${rec.holderName}${what}` });
        return items;
    },

    /** Items for a vacant (or the player's rented/bought) house. */
    buildingItems(game, building) {
        if (!building || !building._vacancy) return [];
        const { s } = _settlement(game);
        if (!s) return [];
        const v = LotBook.vacancy(s, building._vacancy);
        const items = [];
        if (!v) {
            items.push({ type: 'disabled', label: '🔑 Standing empty — to let or for sale' });
            items.push({ type: 'action', action: 'vacancy_rent', label: `Rent it (${LotBook.rentPerDay(s.type)}g a day)`, icon: '🔑', desc: 'Paid at each day\'s end. Miss it and you\'re out.', building });
            items.push({ type: 'action', action: 'vacancy_buy', label: `Buy it (${LotBook.salePrice(s.type)}g)`, icon: '💰', desc: 'Yours outright', building });
        } else if (v.holder === 'player' && v.status === 'rented') {
            items.push({ type: 'disabled', label: `🔑 You rent it at ${v.rent}g a day` });
            items.push({ type: 'action', action: 'vacancy_buy', label: `Buy it outright (${LotBook.salePrice(s.type)}g)`, icon: '💰', desc: 'No more rent', building });
            items.push({ type: 'action', action: 'vacancy_leave', label: 'Give up the House', icon: '🚪', desc: 'Hand back the key', building });
        }
        return items;
    },

    /** Run a lot action. Returns true when it was one of ours. */
    handle(game, item) {
        const { wt, s } = _settlement(game);
        const note = (res, title) => {
            if (res.success) game.ui.showNotification(title, res.text, 'success');
            else game.ui.showNotification('Cannot', res.reason, 'error');
            if (res.success && game.ui.updateStats) game.ui.updateStats(game.player, game.world);
        };
        switch (item.action) {
            case 'lot_buy':
                note(Lots.buyLot(game.player, game.world, s, item.lot), '📜 Lot Bought');
                return true;
            case 'lot_build': {
                const ok = Lots.canBuildOnLot(s, item.lot.id);
                if (!ok.ok) { game.ui.showNotification('Cannot Build', ok.reason, 'error'); return true; }
                InnerMap._pendingPropertyPosition = InnerMap.lotBuildSpot(item.lot);
                InnerMap._pendingLot = item.lot.id;
                if (wt) ActionMenu.handleAction(game, wt, 'build_property');
                return true;
            }
            case 'vacancy_rent':
            case 'vacancy_buy':
            case 'vacancy_leave': {
                const b = item.building;
                const base = String(b.name || 'the house').replace(/ \((To Let|Rented|Yours)\)$/, '');
                const fn = item.action === 'vacancy_rent' ? 'rentHouse' : item.action === 'vacancy_buy' ? 'buyHouse' : 'leaveHouse';
                const res = Lots[fn](game.player, game.world, s, b._vacancy, base);
                note(res, item.action === 'vacancy_leave' ? '🚪 Moved Out' : '🔑 A House in Town');
                if (res.success) {
                    if (item.action === 'vacancy_leave') { b.isPlayerOwned = false; }
                    InnerMap._applyLotHolders(s);
                }
                return true;
            }
        }
        return false;
    },

    /** After a property is built (ui/actionMenu/build.js): if it was for a lot, it stands there. */
    afterBuild(game, worldTile, property) {
        const lotId = InnerMap._pendingLot;
        InnerMap._pendingLot = null;
        if (!lotId || !property) return;
        const s = worldTile && worldTile.settlement;
        Lots.buildOnLot(game.player, game.world, s, lotId, property);
        if (typeof InnerMap.placePropertyOnInnerMap === 'function') InnerMap.placePropertyOnInnerMap(worldTile, property, worldTile.q, worldTile.r);
    },
};
