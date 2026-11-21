// ============================================
// ROWBOATS — a little boat of your own on the street map's water
// ============================================
// A rowboat is not carried about: it lies where you last tied it up, on a
// street map's river, lake or calm inshore sea — recorded by the world hex
// and the cell of that hex's map — and it waits there for you (the street
// map's side, boarding, rowing and the current: ui/innerMapRowboat.js).
//
//   • Bought from the boatwright of a town whose map has water: the price
//     goes into that town's purse (PlayerCoin.pay — every coin to someone,
//     in whole cents), and the boat is launched where you asked.
//   • Built on a bank from what is in your packs (build.ingredients: planks,
//     a rope, resin to pay the seams) over some hours: no coin moves.
//   • Sold back to a boatwright, out of the town's purse (at sellBack of the
//     price, and no more than the purse holds).
//
// State on the player (saved: SaveLoad EXTRA_PLAYER_FIELDS 'rowboats', 'rowboatSeq'):
//   player.rowboats   = [{ id, name, hq, hr, q, r, day, built, carried? }]
//                       (carried: on your shoulders — hq/hr/q/r follow you, see lift / setDown)
//   player.rowboatSeq = the last id number given
// Settings: data/rowboats.json. No randomness, no globals.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { PlayerCoin } from './playerCoin.js';
import { Economy } from '../world/economy.js';

const DEFAULTS = {
    enabled: true, price: 60, sellBack: 0.5, max: 3, rowSpeed: 0.9, carrySpeed: 0.5, mooredOffset: 0.42,
    build: { ingredients: { planks: 6, rope: 1, resin: 1 }, hours: 5 },
    names: ['Little Wren'],
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _label = (id) => String(id).replace(/_/g, ' ');

export const Rowboats = {
    _src: null,
    _cfg: null,

    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.rowboats;
        if (this._src !== src || !this._cfg) {
            this._src = src;
            const s = src || {};
            this._cfg = {
                ...DEFAULTS, ...s,
                build: { ...DEFAULTS.build, ...(s.build || {}), ingredients: { ...((s.build && s.build.ingredients) || DEFAULTS.build.ingredients) } },
                names: Array.isArray(s.names) && s.names.length ? s.names : DEFAULTS.names,
            };
        }
        return this._cfg;
    },

    /** The price of a new boat (whole cents). */
    price() {
        return Utils.cents(Math.max(0, _num(this.config().price, 60)));
    },

    /** Every boat you own: [{ id, name, hq, hr, q, r }] */
    list(player) {
        if (!player) return [];
        if (!Array.isArray(player.rowboats)) player.rowboats = [];
        return player.rowboats;
    },

    get(player, id) {
        return this.list(player).find(b => b && b.id === id) || null;
    },

    /** Your boats lying on the map of world hex (hq, hr). */
    boatsOn(player, hq, hr) {
        return this.list(player).filter(b => b && b.hq === hq && b.hr === hr);
    },

    /** Is there one of your boats lying at cell (q, r) of hex (hq, hr)? (not one you carry) → it, or null */
    boatAt(player, hq, hr, q, r) {
        return this.list(player).find(b => b && !b.carried && b.hq === hq && b.hr === hr && b.q === q && b.r === r) || null;
    },

    /** The boat on your shoulders, or null. */
    carried(player) {
        return this.list(player).find(b => b && b.carried) || null;
    },

    /** Lift a boat of yours onto your shoulders (one at a time). → it, or null */
    lift(player, id) {
        const boat = this.get(player, id);
        if (!boat || this.carried(player)) return null;
        boat.carried = true;
        return boat;
    },

    /** Set the boat you carry down at `at` ({ hq, hr, q, r }): tied up there. → it, or null */
    setDown(player, id, at) {
        const boat = this.get(player, id);
        if (!boat || !this._placeOk(at)) return null;
        this.moor(player, id, at);
        delete boat.carried;
        return boat;
    },

    _newBoat(world, player, at, built) {
        player.rowboatSeq = Math.max(0, Math.floor(_num(player.rowboatSeq))) + 1;
        const names = this.config().names;
        const boat = {
            id: `rb${player.rowboatSeq}`,
            name: names[(player.rowboatSeq - 1) % names.length],
            hq: at.hq, hr: at.hr, q: at.q, r: at.r,
            day: _num(world && world.day), built: !!built,
        };
        this.list(player).push(boat);
        return boat;
    },

    _placeOk(at) {
        return !!(at && [at.hq, at.hr, at.q, at.r].every(Number.isFinite));
    },

    /** The town whose boatwright sells here: the settlement on the player's hex (or null). */
    sellerHere(world, player) {
        return PlayerCoin.townHere(world, player);
    },

    /** Why you couldn't buy a boat here now (or null when you can). */
    whyNotBuy(world, player) {
        const c = this.config();
        if (!c.enabled) return 'No boats are built here.';
        if (!player) return 'No one to buy it.';
        if (!this.sellerHere(world, player)) return 'There is no boatwright out here: buy one in a town by the water, or build your own.';
        if (this.list(player).length >= _num(c.max, 3)) return `You have ${this.list(player).length} boats already.`;
        if (_num(player.gold) < this.price()) return `A rowboat costs ${Utils.formatGold(this.price())}g; you have ${Utils.formatGold(_num(player.gold))}g.`;
        return null;
    },

    /**
     * Buy a rowboat from this town's boatwright, launched at `at`
     * ({ hq, hr, q, r }). The price goes into the town's purse.
     * → { success, text, boat?, paid?, town? }
     */
    buy(world, player, at) {
        const why = this.whyNotBuy(world, player);
        if (why) return { success: false, text: why };
        if (!this._placeOk(at)) return { success: false, text: 'There is no water here to float it.' };
        const town = this.sellerHere(world, player);
        const price = this.price();
        const paid = PlayerCoin.pay(world, player, price, town, 'riverBoats', 'rowboat');
        if (player.financeToday && player.financeToday.expenses) {
            player.financeToday.expenses.riverBoats = Utils.cents(_num(player.financeToday.expenses.riverBoats) + paid);
        }
        const boat = this._newBoat(world, player, at, false);
        return {
            success: true, boat, paid, town,
            text: `You buy a rowboat from ${town.name ? `the boatwright of ${town.name}` : 'the boatwright'} for ${Utils.formatGold(paid)}g. They push the ${boat.name} into the water for you and make her fast to the bank.`,
        };
    },

    /** What building one asks of your packs: [{ id, need, have }] */
    buildNeeds(player) {
        const inv = (player && player.inventory) || {};
        return Object.entries(this.config().build.ingredients || {}).map(([id, n]) => ({ id, need: Math.max(0, Math.floor(_num(n))), have: Math.floor(_num(inv[id])) }));
    },

    /** Why you couldn't build one now (or null). */
    whyNotBuild(player) {
        const c = this.config();
        if (!c.enabled || !player) return 'You can\'t build a boat here.';
        if (this.list(player).length >= _num(c.max, 3)) return `You have ${this.list(player).length} boats already.`;
        const short = this.buildNeeds(player).filter(n => n.have < n.need);
        if (short.length) return `you need ${short.map(n => `${n.need} ${_label(n.id)}`).join(', ')} (you have ${short.map(n => `${n.have} ${_label(n.id)}`).join(', ')})`;
        return null;
    },

    /** Hours a build takes on the clock. */
    buildHours() {
        return Math.max(0, _num(this.config().build.hours, 5));
    },

    /**
     * Build a rowboat on the bank from what is in your packs, launched at `at`.
     * No coin moves: the goods are used up. → { success, text, boat?, hours? }
     */
    build(world, player, at) {
        const why = this.whyNotBuild(player);
        if (why) return { success: false, text: why.charAt(0).toUpperCase() + why.slice(1) + '.' };
        if (!this._placeOk(at)) return { success: false, text: 'There is no water here to float it.' };
        const inv = player.inventory;
        for (const n of this.buildNeeds(player)) {
            inv[n.id] = _num(inv[n.id]) - n.need;
            if (inv[n.id] <= 0) delete inv[n.id];
        }
        const boat = this._newBoat(world, player, at, true);
        const hours = this.buildHours();
        return { success: true, boat, hours, text: `${hours ? `${hours} hours of sawing, pegging and paying the seams with resin, and` : 'At last'} the ${boat.name} is done. You slide her down the bank into the water and tie her up.` };
    },

    /** What this town's boatwright gives for a boat of yours (out of the town's purse). */
    saleValue(world, player) {
        const town = this.sellerHere(world, player);
        if (!town || town.inKind) return 0;
        const want = Utils.centsDown(this.price() * Math.max(0, Math.min(1, _num(this.config().sellBack, 0.5))));
        const purse = Economy.townPurse(town);
        return purse == null ? want : Math.min(want, Utils.centsDown(purse));
    },

    /** Sell a boat of yours (lying on this hex's map) to this town's boatwright. → { success, text, gold? } */
    sell(world, player, id) {
        const boat = this.get(player, id);
        if (!boat) return { success: false, text: 'You have no such boat.' };
        const town = this.sellerHere(world, player);
        if (!town) return { success: false, text: 'There is no boatwright here to buy it.' };
        if (boat.hq !== player.q || boat.hr !== player.r) return { success: false, text: 'That boat is not here.' };
        const value = this.saleValue(world, player);
        if (!(value > 0)) return { success: false, text: 'The boatwright has no coin to buy it.' };
        const got = PlayerCoin.receive(world, player, value, town, 'riverBoats', { strict: true });
        if (!(got > 0)) return { success: false, text: 'The boatwright has no coin to buy it.' };
        this.remove(player, id);
        return { success: true, gold: got, text: `The boatwright gives you ${Utils.formatGold(got)}g for the ${boat.name}.` };
    },

    /** Tie the boat up (or carry it on) at `at` ({ hq, hr, q, r }). */
    moor(player, id, at) {
        const boat = this.get(player, id);
        if (!boat || !this._placeOk(at)) return null;
        boat.hq = at.hq; boat.hr = at.hr; boat.q = at.q; boat.r = at.r;
        return boat;
    },

    remove(player, id) {
        const list = this.list(player);
        const i = list.findIndex(b => b && b.id === id);
        if (i >= 0) list.splice(i, 1);
        return i >= 0;
    },
};
