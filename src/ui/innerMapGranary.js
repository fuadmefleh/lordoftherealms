// ============================================================
// INNER MAP — buying grain at the town's granary
// ============================================================
// The granary holds the town's food store (settlement.economy.food: what the
// people eat from, world/economy.js, and where the farmers carry the harvest,
// world/innerMap/townLife.js). The keeper sells what the town can spare, a
// unit of grain for a unit of food, at a little under the market's ask
// (no stallholder's cut), and keeps back reserveDays of the town's needs:
// in a lean year there is nothing to sell. The gold goes to the town.
// The keeper also buys grain into the store, at a lower price (buyMult of
// the ask), while there is room in it (Economy.FOOD.stockDays of needs);
// the keeper pays out of the town's coffers (settlement.economy.gold), and
// when the purse runs dry, buys no more.
// Tables in data/townProps.json granary.

import { InnerMap } from '../world/innerMap.js';
import { Economy } from '../world/economy.js';
import { DataLoader } from '../core/dataLoader.js';
import { Containers } from '../systems/containers.js';
import { Ledger } from '../systems/ledger.js';
import { Hotbar } from './hotbar.js';

const _cfg = () => {
    const d = (DataLoader.get && DataLoader.get('townProps')) || (DataLoader._gamedata && DataLoader._gamedata.townProps) || {};
    return { reserveDays: 3, priceMult: 0.9, buyMult: 0.7, lots: [1, 5, 20], ...(d.granary || {}) };
};

function _settlement() {
    const ref = InnerMap._currentWorldTileRef;
    return ref && ref.settlement ? { settlement: ref.settlement, tile: ref } : null;
}

export const InnerMapGranary = {
    /** Grain the granary can spare (whole units). */
    spare(settlement) {
        const econ = settlement && settlement.economy;
        if (!econ) return 0;
        const pop = Math.max(0, Number(settlement.population) || 0);
        const reserve = pop * Economy.FOOD.perCapita * (Number(_cfg().reserveDays) || 0);
        return Math.max(0, Math.floor((Number(econ.food) || 0) - reserve));
    },

    /** Room left in the store (whole units). */
    room(settlement) {
        const econ = settlement && settlement.economy;
        if (!econ) return 0;
        const pop = Math.max(0, Number(settlement.population) || 0);
        const cap = pop * Economy.FOOD.perCapita * Economy.FOOD.stockDays;
        return Math.max(0, Math.floor(cap - (Number(econ.food) || 0)));
    },

    /** How many units the keeper's purse (the town's coffers) can pay for at `pay` each. */
    affords(settlement, pay) {
        const gold = Math.max(0, Number(settlement && settlement.economy && settlement.economy.gold) || 0);
        return pay > 0 ? Math.floor(gold / pay) : 0;
    },

    /** The granary's price for a unit of grain (`buying`: what the keeper pays for it). */
    price(game, settlement, tile, buying = false) {
        const good = Containers.good('grain');
        const ask = Economy.marketPrice(good, settlement, tile, game.world) || good.basePrice || 5;
        const C = _cfg();
        const mult = buying ? (Number(C.buyMult) || 0.7) : (Number(C.priceMult) || 1);
        return Math.max(1, Math.round(ask * mult));
    },

    /** The entries for selling the player's grain into the store. */
    _sellItems(game, at, building) {
        const g = Containers.good('grain');
        const have = Math.floor(Number(game.player.inventory && game.player.inventory.grain) || 0);
        if (have <= 0) return [];
        const room = InnerMapGranary.room(at.settlement);
        if (room <= 0) return [{ type: 'disabled', label: `${g.icon} The granary is full: the keeper buys no more` }];
        const pay = InnerMapGranary.price(game, at.settlement, at.tile, true);
        const afford = InnerMapGranary.affords(at.settlement, pay);
        if (afford <= 0) return [{ type: 'disabled', label: '💰 The keeper’s purse is empty: no grain bought today' }];
        const most = Math.min(have, room, afford);
        const why = most === have ? 'all you have' : most === afford ? 'all the keeper can pay for' : 'all it has room for';
        const lots = [...new Set([..._cfg().lots.filter(n => n < most), most])];
        return lots.map(k => ({
            type: 'action', action: 'granary_sell', qty: k, building,
            label: k === most && k > 1 ? `Sell ${k} ${g.name} (${why})` : `Sell ${k} ${g.name}`,
            icon: '💰', desc: `${k * pay} gold, into the town's store`,
        }));
    },

    /** Menu entries for a granary (not one of the player's own). */
    menuItems(game, building) {
        if (!building || building.type !== 'granary' || building.isPlayerOwned || building.isPlayerProperty) return [];
        const at = _settlement();
        if (!at || !at.settlement.economy) return [];
        const spare = InnerMapGranary.spare(at.settlement);
        const g = Containers.good('grain');
        const sell = InnerMapGranary._sellItems(game, at, building);
        if (spare <= 0) return [{ type: 'disabled', label: `${g.icon} No grain to spare: the town keeps what it has` }, ...sell];
        const price = InnerMapGranary.price(game, at.settlement, at.tile);
        const items = [{ type: 'disabled', label: `${g.icon} ${spare} ${g.name} to spare, ${price}g each` }];
        for (const k of _cfg().lots.filter(n => n <= spare)) {
            items.push({
                type: 'action', action: 'granary_buy', qty: k, building,
                label: `Buy ${k} ${g.name}`, icon: g.icon, desc: `${k * price} gold, from the town's store`,
            });
        }
        return items.concat(sell);
    },

    /** Carry out a granary_* action. Returns true when it was one. */
    handle(game, item) {
        if (!/^granary_/.test(item.action || '')) return false;
        const at = _settlement();
        const player = game.player;
        const g = Containers.good('grain');
        if (item.action === 'granary_sell') return InnerMapGranary._sell(game, at, item);
        const spare = at ? InnerMapGranary.spare(at.settlement) : 0;
        const n = Math.min(spare, Math.max(1, Math.floor(item.qty || 1)));
        if (n <= 0) {
            game.ui.showNotification('🌾 Nothing to Spare', 'The keeper shakes their head: the town needs every sack it has.', 'warning');
            return true;
        }
        const price = InnerMapGranary.price(game, at.settlement, at.tile);
        const cost = n * price;
        if ((Number(player.gold) || 0) < cost) {
            game.ui.showNotification('🌾 Not Enough Gold', `${n} ${g.name} comes to ${cost} gold.`, 'warning');
            return true;
        }
        player.gold -= cost;
        Ledger.record(player, 'goodsBought', -cost);
        const econ = at.settlement.economy;
        econ.food = Math.max(0, (Number(econ.food) || 0) - n);
        econ.gold = (Number(econ.gold) || 0) + cost;
        if (!player.inventory) player.inventory = {};
        player.inventory.grain = (Number(player.inventory.grain) || 0) + n;
        game.ui.showNotification('🌾 Grain Bought', `The keeper measures out ${n} ${g.name} from the town's store for ${cost} gold.`, 'success');
        game.ui.updateStats(player, game.world);
        Hotbar.refresh();
        return true;
    },

    /** Sell the player's grain into the town's store. */
    _sell(game, at, item) {
        const player = game.player;
        const g = Containers.good('grain');
        const have = Math.floor(Number(player.inventory && player.inventory.grain) || 0);
        const room = at && at.settlement.economy ? InnerMapGranary.room(at.settlement) : 0;
        const unit = at ? InnerMapGranary.price(game, at.settlement, at.tile, true) : 0;
        const afford = at ? InnerMapGranary.affords(at.settlement, unit) : 0;
        const n = Math.min(have, room, afford, Math.max(1, Math.floor(item.qty || 1)));
        if (n <= 0) {
            const why = have <= 0 ? 'You have no grain to sell.'
                : room <= 0 ? 'The granary is full to the rafters: the keeper buys no more.'
                    : 'The keeper turns out an empty purse: the town has no coin to pay for grain today.';
            game.ui.showNotification('🌾 No Sale', why, 'warning');
            return true;
        }
        const pay = n * unit;
        player.inventory.grain = have - n;
        if (!player.inventory.grain) delete player.inventory.grain;
        player.gold = (Number(player.gold) || 0) + pay;
        Ledger.record(player, 'goodsSold', pay);
        const econ = at.settlement.economy;
        econ.food = (Number(econ.food) || 0) + n;
        econ.gold = (Number(econ.gold) || 0) - pay;
        game.ui.showNotification('🌾 Grain Sold', `The keeper weighs your ${n} ${g.name} into the town's store and pays you ${pay} gold.`, 'success');
        game.ui.updateStats(player, game.world);
        Hotbar.refresh();
        return true;
    },
};
