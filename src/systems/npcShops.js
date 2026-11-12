// ============================================
// NPC SHOPS — the street map's merchants, travelling traders and smiths
// ============================================
// world/innerMap/state.js _generateNpcShop rolls what each trader deals in
// and how much they'd carry (npc.shopInventory = { goodId: { qty, markup } });
// the trade menu (ui/actionMenu/trade.js showNpcTradeMenu), free talk
// (systems/npcChat.js) and a beaten trader's spoils (ui/innerMapCombat.js)
// go through here, so every unit and every coin is a real one:
//
//   WHERE THE GOODS ARE (`source`)
//     - a trader on the town's roster (npc._person): their own wares first
//       (systems/townTrade.js st.wares — the coin to their purse), then the
//       town market's stock on consignment (the coin to the town's purse,
//       `commission` of it to the trader's);
//     - a merchant or smith with no roster record: the town market's stock
//       on consignment (the coin to the town's purse);
//     - a travelling trader: their home town's market on consignment — a
//       neighbouring town by who they are (TownTrade.neighbours), else the
//       town they stand in; the coin to that town's purse.
//   The shop is a VIEW (`sync`): the roll's quantity capped at what the
//   source has right now (the market keeps keepShare of its target back);
//   nothing is set aside, so leaving the map loses nothing and the market
//   sells nothing twice. A good no market trades is dealt as its stand-in
//   (data/townTrade.json shops.standIn: silk → luxuries), else not at all.
//
//   THE PLAYER SELLS (`sell`): the trader buys for the market they stand
//   for — the goods into its stock, the coin out of that town's purse, as
//   far as it has it (a short purse buys fewer). Only goods a market trades.
//   A town that barters (world/barter.js inKind) deals in no coin: nothing
//   on consignment, nothing bought.
//
// Nothing is made or lost: the economyConservation spec sums market stock,
// TownTrade holdings, purses, the town purses and the player's packs and
// gold across buys and sells. No randomness (a hash picks a traveller's
// home); no state of its own (old saves: the shop syncs on first look).

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Townsfolk } from './townsfolk.js';
import { TownTrade } from './townTrade.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _r2 = (v) => Math.round(v * 100) / 100;
const _key = (s) => `${s.q},${s.r}`;

const DEFAULTS = { commission: 0.1, keepShare: 0.25, standIn: {} };

function _hide(npc, k, v) {
    Object.defineProperty(npc, k, { value: v, configurable: true, enumerable: false, writable: true });
}

export const NpcShops = {
    config() {
        const g = DataLoader._gamedata;
        const d = _obj(g && g.townTrade && g.townTrade.shops) || {};
        return { ...DEFAULTS, ...d, standIn: { ...DEFAULTS.standIn, ...(_obj(d.standIn) || {}) } };
    },

    /** The good a shop really deals for `id`: itself if a market trades it, else its stand-in, else null. */
    dealt(id) {
        if (SettlementMarket.tracks(id)) return id;
        const s = NpcShops.config().standIn[id];
        return s && SettlementMarket.tracks(s) ? s : null;
    },

    /**
     * Where a trader's goods are: { town (whose market consigns), person (a
     * roster record, whose wares come first), away (a traveller's home town) }.
     */
    source(world, s, npc) {
        if (!s || !npc) return null;
        const person = npc._person && _obj(s.folk) ? npc._person : null;
        let town = s;
        let away = false;
        if (!person && npc.type === 'traveler') {
            const opts = TownTrade.neighbours(world, s).filter(n => !TownTrade.inKind(n.s));
            if (opts.length) {
                const u = (Utils.hashStr(`npcShop|${npc.fullName || npc.name || ''}|${npc.id != null ? npc.id : ''}|${_key(s)}`) >>> 0) / 4294967296;
                town = opts[Math.floor(u * opts.length) % opts.length].s;
                away = true;
            }
        }
        return { town, person, away };
    },

    /** Whole units of a good a person has in their own wares. */
    _own(s, person, g) {
        const st = s && _obj(s.townTrade);
        if (!st || !person) return 0;
        return Math.floor(_num((st.wares[person.id] || {})[g]) + 1e-9);
    },

    /** Whole units of a good a market will let go on consignment (its stock above keepShare of its target). */
    _consignable(town, g) {
        if (!town || TownTrade.inKind(town) || !SettlementMarket.tracks(g)) return 0;
        const keep = SettlementMarket.target(town, g) * _num(NpcShops.config().keepShare, 0.25);
        return Math.max(0, Math.floor(SettlementMarket.stock(town, g) - keep + 1e-9));
    },

    /**
     * Bring the trader's shop to what its source really holds (in place):
     * untraded goods become their stand-ins, each line's quantity the roll's
     * (`want`, kept from the first look) capped at the source, and a roster
     * trader's own wares added. → npc.shopInventory (or null).
     */
    sync(world, s, npc) {
        const inv = npc && _obj(npc.shopInventory);
        if (!inv) return null;
        const src = NpcShops.source(world, s, npc);
        if (!src) return inv;
        // Stand-ins for what no market trades (the first look only: `want` set after)
        for (const id of Object.keys(inv)) {
            const e = inv[id];
            if (!_obj(e)) { delete inv[id]; continue; }
            if (e.want == null) e.want = Math.max(0, Math.floor(_num(e.qty)));
            const d = NpcShops.dealt(id);
            if (d === id) continue;
            delete inv[id];
            if (!d) continue;
            const o = inv[d];
            if (o) o.want = _num(o.want, _num(o.qty)) + e.want;
            else inv[d] = { ...e, qty: e.want };
        }
        // A roster trader's own wares are on the board too
        const st = s && _obj(s.townTrade);
        if (src.person && st) {
            for (const g of Object.keys(st.wares[src.person.id] || {})) {
                const n = NpcShops._own(s, src.person, g);
                if (n >= 1 && !inv[g]) inv[g] = { qty: n, markup: 1, want: 0 };
            }
        }
        for (const [id, e] of Object.entries(inv)) {
            const own = NpcShops._own(s, src.person, id);
            e.qty = Math.min(_num(e.want), NpcShops._consignable(src.town, id)) + own;
            e.own = own;
            if (e.want === 0 && own <= 0) delete inv[id];
        }
        _hide(npc, '_shopSrc', { at: _key(src.town), away: src.away });
        return inv;
    },

    /** What the shop has, priced at the source town's market × the trader's markup: { id: { qty, price } } (free talk's stock). */
    stock(world, s, npc) {
        const inv = NpcShops.sync(world, s, npc);
        const src = NpcShops.source(world, s, npc);
        const out = {};
        if (!inv || !src) return out;
        for (const [id, e] of Object.entries(inv)) {
            if (!(e.qty >= 1)) continue;
            const p = TownTrade.price(world, src.town, id);
            out[id] = { qty: e.qty, price: Math.max(1, Math.round(_num(p, 1) * _num(e.markup, 1))) };
        }
        return out;
    },

    /**
     * Take `n` units of a good out of the trader's real stock — their own
     * wares first, then the consigning market's — for a sale, a gift or a
     * beaten trader's spoils. → { n, own, market, town } (units really taken).
     */
    take(world, s, npc, id, n) {
        const src = NpcShops.source(world, s, npc);
        const out = { n: 0, own: 0, market: 0, town: src ? src.town : null };
        const want = Math.max(0, Math.floor(_num(n)));
        if (!src || !want) return out;
        const own = Math.min(want, NpcShops._own(s, src.person, id));
        if (own > 0) out.own = Math.floor(TownTrade.takeWares(s, src.person, id, own) + 1e-9);
        const fromMkt = Math.min(want - out.own, NpcShops._consignable(src.town, id));
        if (fromMkt > 0) out.market = TownTrade._stockTake(src.town, id, fromMkt);
        out.n = out.own + out.market;
        const e = npc.shopInventory && npc.shopInventory[id];
        if (e) {
            e.qty = Math.max(0, _num(e.qty) - out.n);
            e.want = Math.max(0, _num(e.want) - out.market);
            e.own = Math.max(0, _num(e.own) - out.own);
            if (e.qty <= 0) delete npc.shopInventory[id];
        }
        _hide(npc, '_shopLast', { at: src.town ? _key(src.town) : null, own: out.own, market: out.market, pid: src.person ? src.person.id : null });
        return out;
    },

    /**
     * The coin for what was taken: own wares' share to the trader's purse,
     * the consigned share to the town's purse (commission to a roster
     * trader). `taken`: take()'s result. → coin placed.
     */
    pay(world, s, npc, taken, coin) {
        const c = _r2(Math.max(0, _num(coin)));
        if (!(c > 0) || !taken || !(taken.n > 0)) return 0;
        const src = NpcShops.source(world, s, npc);
        const person = src && src.person;
        const ownCoin = _r2(c * taken.own / taken.n);
        let mktCoin = _r2(c - ownCoin);
        let toPerson = ownCoin;
        if (person && mktCoin > 0) {
            const cut = _r2(mktCoin * Math.max(0, Math.min(1, _num(NpcShops.config().commission, 0.1))));
            toPerson = _r2(toPerson + cut);
            mktCoin = _r2(mktCoin - cut);
        }
        let placed = 0;
        if (mktCoin > 0) {
            const paid = Economy.payTown(taken.town || s, mktCoin);
            placed += paid;
            // (a town that takes no coin: the trader keeps it)
            if (paid < mktCoin) toPerson = _r2(toPerson + mktCoin - paid);
        }
        if (toPerson > 0) {
            if (person) person.purse = _r2((s && s.folk ? Townsfolk.purse(s.folk, person, world) : _num(person.purse)) + toPerson);
            else npc.purse = _r2(_num(npc.purse) + toPerson);
            placed += toPerson;
        }
        return _r2(placed);
    },

    /**
     * The player buys `qty` of a good at `unit` coin each: the units out of
     * the trader's real stock into the player's packs, the coin to whose
     * goods they were. → { ok, qty, cost, reason }
     */
    buy(player, world, s, npc, id, qty, unit) {
        if (!player || !npc) return { ok: false, reason: 'No one to buy from.' };
        NpcShops.sync(world, s, npc);
        const e = npc.shopInventory && npc.shopInventory[id];
        const n = Math.min(Math.max(1, Math.floor(_num(qty, 1))), e ? Math.floor(_num(e.qty)) : 0);
        if (!(n > 0)) return { ok: false, reason: 'They have none of that left.' };
        const each = Math.max(0, _num(unit));
        if (_num(player.gold) < each * n) return { ok: false, reason: `You need ${each * n} gold.` };
        if (!PlayerInventory.canAdd(player, id)) return { ok: false, reason: PlayerInventory.fullMessage(player) };
        const taken = NpcShops.take(world, s, npc, id, n);
        if (!(taken.n > 0)) return { ok: false, reason: 'They have none of that left.' };
        const cost = each * taken.n;
        PlayerInventory.addItem(player, id, taken.n, { force: true });
        player.gold = _num(player.gold) - cost;
        NpcShops.pay(world, s, npc, taken, cost);
        return { ok: true, qty: taken.n, cost };
    },

    /** Coin the trader's market can spend on the player's goods (Infinity for a town that keeps no purse). */
    purse(world, s, npc) {
        const src = NpcShops.source(world, s, npc);
        if (!src || TownTrade.inKind(src.town)) return 0;
        const have = Economy.townPurse(src.town);
        return have == null ? Infinity : have;
    },

    /** Will this trader buy the good at all (a market trades it, the town deals in coin)? */
    buys(world, s, npc, id) {
        const src = NpcShops.source(world, s, npc);
        return !!(src && SettlementMarket.tracks(id) && !TownTrade.inKind(src.town));
    },

    /**
     * The player sells `qty` of a good: `total(q)` the coin for q units. The
     * trader buys for their market: the goods into its stock, the coin out
     * of its town's purse — as many as it can pay for. opts.take(q): the
     * caller's own removal hook run first (the grades, player/crafting.js).
     * → { ok, qty, paid, reason }
     */
    sell(player, world, s, npc, id, qty, total, opts = {}) {
        if (!player || !npc) return { ok: false, reason: 'No one to sell to.' };
        if (!NpcShops.buys(world, s, npc, id)) return { ok: false, reason: 'They have no market for that.' };
        const have = Math.floor(_num(player.inventory && player.inventory[id]));
        let n = Math.min(Math.max(1, Math.floor(_num(qty, 1))), have);
        if (!(n > 0)) return { ok: false, reason: 'You don\'t have enough of that.' };
        const price = typeof total === 'function' ? total : (q) => Math.floor(_num(total) * q / Math.max(1, n));
        const purse = NpcShops.purse(world, s, npc);
        while (n > 0 && price(n) > purse) n--;
        if (!(n > 0)) return { ok: false, reason: 'They haven\'t the coin to buy that.' };
        const src = NpcShops.source(world, s, npc);
        const due = Math.max(0, Math.floor(price(n)));
        if (typeof opts.take === 'function') opts.take(n);
        player.inventory[id] = have - n;
        if (player.inventory[id] <= 0) delete player.inventory[id];
        const paid = Economy.drawTown(src.town, due);
        TownTrade._stockAdd(src.town, id, n);
        player.gold = _num(player.gold) + paid;
        return { ok: true, qty: n, paid };
    },
};
