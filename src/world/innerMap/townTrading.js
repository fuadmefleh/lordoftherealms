// ============================================
// InnerMap — the townsfolk trading in the street
// ============================================
// Over world/innerMap/townLife.js (who goes where each hour) and townScenes.js
// (the stalls and their keepers), the town's own trade made visible, each
// deal a real one through systems/townTrade.js:
//   - a shopper at a staffed stall buys what their household's larder lacks
//     of the stall's goods (TownTrade.stallBuy: off the market's stock, the
//     coin to the town's purse), haggles, pays and carries a sack home;
//     "Robbery!" when the bargain was dear, the warden's fine called out
//     when short weight is caught;
//   - a producer with more than their keep carries a sack to market of a
//     morning (TownTrade.deliverOne: their wares into the market's stock);
//   - bakers, fishers, brewers… cry their wares in the street, and a
//     passer-by whose larder lacks it buys (TownTrade.buyFrom, purse to purse);
//   - neighbours stop each other to swap (TownTrade.streetBarter);
//   - a pedlar in town (TownTrade.pedlarIn) walks the streets crying his pack.
// Draws only from Utils (seedable) and hashes; data: data/townTrade.json onMap.

import { InnerMap } from './_ref.js';
import { Utils } from './_imports.js';
import { TownTrade } from '../../systems/townTrade.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _arr = (v) => (Array.isArray(v) ? v : []);
const _span = (r, u) => (_arr(r).length >= 2 ? _num(r[0]) + (_num(r[1]) - _num(r[0])) * u : _num(_arr(r)[0], 10));

Object.assign(InnerMap, {
    /** The town this map is, and the world it was entered with (set on spawning its people). */
    _tradeCtx() {
        const s = this._currentWorldTileRef && this._currentWorldTileRef.settlement;
        const world = this._tradeWorld;
        if (!s || !world || !TownTrade.enabled() || !s.folk) return null;
        return { s, world };
    },

    _tradeSay(npc, text, delay = 0) {
        if (!text || !this._sceneSay || !this._sceneNear || !this._sceneNear(npc.q, npc.r)) return;
        this._sceneSay(npc, text, delay);
    },

    /** On entering a town (after its people are spawned): a pedlar in town walks its streets. */
    _tradeSpawn(settlement, world) {
        this._tradeWorld = world || null;
        if (!world || !TownTrade.enabled() || !settlement) return;
        const ped = TownTrade.seePedlars(world, settlement, _num(world.day, 1));
        if (!ped || !this._makeNpc) return;
        let seed = (Utils.hashStr(`ped|${ped.id}`) >>> 0) || 1;
        const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const npc = this._makeNpc('traveler', (this.npcs || []).length, rng);
        if (!npc) return;
        npc.name = String(ped.name).split(' ')[0];
        npc.fullName = ped.name;
        npc.roleTitle = `pedlar from ${ped.fromName || 'the road'}`;
        npc.visitsLeft = 99;
        npc.shopInventory = null;
        Object.defineProperty(npc, '_pedlar', { value: ped.id, configurable: true, enumerable: false, writable: true });
        (this.npcs || (this.npcs = [])).push(npc);
    },

    /**
     * A new day while in town (ui/game/endDay.js): a pedlar come in off the
     * road walks in from the town's edge; one moved on is off down the road.
     */
    _tradeNewDay(world) {
        const s = this._currentWorldTileRef && this._currentWorldTileRef.settlement;
        if (!s || !world || !TownTrade.enabled() || this._insideBuilding) return;
        const day = _num(world.day, 1);
        const ped = TownTrade.pedlarIn(s, day);
        for (const n of this.npcs || []) {
            if (!n._pedlar || (ped && n._pedlar === ped.id)) continue;
            n._pedlar = null;
            n.visitsLeft = 0;   // (a traveller with no visits left heads for the map's edge: npcs.js)
        }
        if (ped && !(this.npcs || []).some(n => n._pedlar === ped.id)) this._tradeSpawn(s, world);
    },

    /** The pedlar this NPC is (its record in the town's trade), or null. */
    pedlarOf(npc) {
        const c = this._tradeCtx();
        if (!c || !npc || !npc._pedlar) return null;
        return TownTrade.pedlars(c.s).find(p => p.id === npc._pedlar) || null;
    },

    /**
     * A trade's sack carried (townLife._townPickActivity, before the harvest
     * is carried in): one bought at a stall goes home, a producer's goes to
     * market. true when it took them somewhere.
     */
    _tradeCarry(npc) {
        const c = npc && npc._carry;
        // A sack bought at a stall goes home
        if (c && c.bought) {
            if (npc._home && this._goInto(npc, npc._home, 'home')) return true;
            npc._carry = null;
            return false;
        }
        // A sack of their own goods to market
        if (c && c.toMarket) {
            const mk = (this._townBuildings ? this._townBuildings() : []).find(b => b.type === 'marketplace');
            if (mk && this._goInto(npc, mk, 'market')) return true;
            this._tradeDeliver(npc);
            return false;
        }
        return false;
    },

    /**
     * The hour's pick for trading (townLife._townPickActivity, after the
     * scenes' own — the stall, the church, the crier): a producer's sack to
     * market of a morning, a hawker's round, a pedlar's round, a neighbour
     * to swap with. true when it took them somewhere.
     */
    _tradePick(npc, period) {
        const ctx = this._tradeCtx();
        if (!ctx || npc.type === 'child' || npc.type === 'guard' || npc._stall || npc._wedding || npc._rite) return false;
        const M = TownTrade.config().onMap;
        const rnd = Utils.random;
        // A pedlar walks door to door, crying his pack
        if (npc._pedlar) {
            if (period === 'night') return false;
            const houses = (this._townBuildings ? this._townBuildings() : []).filter(b => b.type === 'house');
            const b = houses.length ? houses[Math.floor(rnd() * houses.length)] : null;
            const spot = b ? this._findPassableAdjacentTile(b.q, b.r) : null;
            return !!(spot && this._goStand(npc, spot, 'peddle', 2));
        }
        const p = npc._person;
        if (!p) return false;
        // Of a morning a producer with more than their keep carries it to market
        if ((period === 'dawn' || period === 'morning') && rnd() < _num(M.deliverChance, 0.5)) {
            const w = (ctx.s.townTrade && ctx.s.townTrade.wares[p.id]) || {};
            const keep = _num(TownTrade.config().wares.keep, 2);
            const g = TownTrade.producerGoods(p).find(x => _num(w[x]) > keep + 0.5);
            if (g) {
                npc._carry = { good: g, qty: 0, toMarket: true };
                this._tradeSay(npc, TownTrade.line('deliver', rnd()));
                const mk = (this._townBuildings ? this._townBuildings() : []).find(b => b.type === 'marketplace');
                if (mk && this._goInto(npc, mk, 'market')) return true;
                this._tradeDeliver(npc);
            }
        }
        // A hawker crying their wares in the street
        if ((period === 'morning' || period === 'midday') && _arr(M.hawkers).includes(p.job && p.job.id) && rnd() < _num(M.hawkChance, 0.25)) {
            const g = TownTrade.hawkGood(ctx.s, p);
            const A = this.townArea && this.townArea();
            if (g && A) {
                npc._hawk = g;
                const spot = this.townSpot(rnd, A.square && A.square.length && rnd() < 0.5 ? A.square[Math.floor(rnd() * A.square.length)] : A.center, 8);
                if (spot && this._goStand(npc, spot, 'hawk', 2)) return true;
                npc._hawk = null;
            }
        }
        // A neighbour stopped for a swap
        if (period !== 'night' && period !== 'dawn' && rnd() < _num(M.barterChance, 0.08)) {
            const other = this._tradeNeighbour(npc, _num(M.barterRadius, 12));
            if (other) {
                const at = this._findPassableAdjacentTile(other.q, other.r);
                other.path = null;
                other.state = 'idle';
                other.idleTimer = Math.max(other.idleTimer || 0, 14);
                other._awaiting = npc.id;
                npc._barterWith = other.id;
                if (this._goStand(npc, at, 'barter')) return true;
                other._awaiting = null;
                npc._barterWith = null;
            }
        }
        return false;
    },

    /** Someone idle nearby of another household to swap with. */
    _tradeNeighbour(npc, radius) {
        const p = npc._person;
        return (this.npcs || []).find(o => o !== npc && o._person && o._person !== p && o.state === 'idle' && !o._dialogFrozen && !o._fight
            && o.type !== 'guard' && o.type !== 'child' && !o._chatWith && o._awaiting == null && !o.departing && !o._stall && !o._carry
            && o._person.hh !== p.hh && Math.max(Math.abs(o.q - npc.q), Math.abs(o.r - npc.r)) <= radius) || null;
    },

    /** Arrived at a trading business (townLife._npcArrivedInTown, after the scene's own). */
    _tradeArrived(npc, act) {
        const ctx = this._tradeCtx();
        if (!ctx) return;
        const M = TownTrade.config().onMap;
        const u = Utils.random();
        switch (act) {
            case 'shop': return this._tradeAtStall(npc, ctx);
            case 'hawk': {
                const g = npc._hawk;
                if (!g) return;
                npc.activity = { type: 'hawk', icon: '📣', label: `Crying ${TownTrade.goodName(g)}`, anim: 'emotes', _scene: true };
                npc.idleTimer = _span(M.hawkStay, u);
                this._tradeSay(npc, TownTrade.cry(g, u));
                // A passer-by whose larder lacks it buys
                const buyer = (this.npcs || []).find(o => o !== npc && o._person && o.state !== 'inside_building' && o.type !== 'child'
                    && Math.max(Math.abs(o.q - npc.q), Math.abs(o.r - npc.r)) <= 5);
                if (buyer) {
                    const r = TownTrade.buyFrom(ctx.world, ctx.s, buyer._person, npc._person, g);
                    if (r) {
                        const pair = TownTrade.line('buy', Utils.random(), { good: TownTrade.goodName(g) });
                        if (pair) { this._tradeSay(buyer, pair[0], 1600); this._tradeSay(npc, pair[1], 3600); }
                    }
                }
                npc._hawk = null;
                return;
            }
            case 'barter': {
                const other = (this.npcs || []).find(o => o.id === npc._barterWith);
                npc._barterWith = null;
                if (!other) return;
                other._awaiting = null;
                npc.idleTimer = _span(M.barterStay, u);
                other.idleTimer = Math.max(other.idleTimer || 0, npc.idleTimer);
                const r = TownTrade.streetBarter(ctx.world, ctx.s, npc._person, other._person);
                if (!r) return;
                npc.activity = { type: 'barter', icon: '🤝', label: 'Swapping goods', anim: 'emotes', _scene: true };
                const pair = TownTrade.line('barter', u, { give: TownTrade.goodName(r.give), get: TownTrade.goodName(r.get) });
                if (pair) { this._tradeSay(npc, pair[0]); this._tradeSay(other, pair[1], 2000); }
                return;
            }
            case 'peddle': {
                const ped = this.pedlarOf(npc);
                npc.activity = { type: 'peddle', icon: '🎒', label: 'Crying his pack', anim: 'emotes', _scene: true };
                npc.idleTimer = _span(M.hawkStay, u);
                if (ped) this._tradeSay(npc, TownTrade.line('pedlar', u, { from: ped.fromName || 'afar' }));
                return;
            }
            default:
        }
    },

    /** A shopper at a staffed stall (townScenes' 'shop'): the real purchase, and the sack. */
    _tradeAtStall(npc, ctx) {
        const st = npc._shopAt;
        const v = st && (this.npcs || []).find(n => n.id === st.vendorId && n._vending === st);
        if (!v || !npc._person) return;
        const goods = this._sceneStallGoods ? this._sceneStallGoods(v) : [];
        const r = TownTrade.stallBuy(ctx.world, ctx.s, npc._person, goods, v);
        if (!r) return;
        const u = Utils.random();
        // (after the haggle townScenes said: the outcome)
        if (r.ok) {
            npc._carry = { good: r.g, qty: 0, bought: true };
            if (r.dear) this._tradeSay(npc, TownTrade.line('dear', u), 4800);
            this._tradeSay(v, TownTrade.line('paid', u), 6200);
            if (r.caught) this._tradeSay(npc, TownTrade.line('fined', u, { name: v.name }), 7600);
        } else if (r.look) {
            this._tradeSay(npc, TownTrade.line('look', u), 4800);
        } else if (r.broke) {
            this._tradeSay(npc, TownTrade.line('broke', u), 4800);
        }
    },

    /** A producer's sack reached the market: their wares over the keep into its stock. */
    _tradeDeliver(npc) {
        const ctx = this._tradeCtx();
        npc._carry = null;
        if (ctx && npc._person) TownTrade.deliverOne(ctx.world, ctx.s, npc._person);
    },

    /** Gone indoors with a trade's sack (townLife._townDelivered): true when it was ours. */
    _tradeDelivered(npc, bldg) {
        const c = npc && npc._carry;
        if (!c || !bldg) return false;
        if (c.bought) {
            if (bldg === npc._home || bldg.type === 'house') npc._carry = null;
            return true;
        }
        if (c.toMarket) {
            if (bldg.type === 'marketplace') this._tradeDeliver(npc);
            return true;
        }
        return false;
    },
});
