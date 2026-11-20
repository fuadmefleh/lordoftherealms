// ============================================
// HEIR ARRIVAL — where a new ruler takes up the mantle, and what they eat
// ============================================
// A ruler who dies on the road (starved on a hill, cut down in the wild) does
// not hand the House on at the spot where they fell: the heir was elsewhere —
// at the House's seat, away at their schooling, or with their branch — and
// takes up the mantle there (Relationships.succeedAsHeir calls
// player.takeUpTheMantle → HeirArrival.arrive). In order:
//
//   1. a child away on their years abroad (systems/heirPaths.js) is there;
//   2. a cadet branch's head comes from the branch's seat (systems/cadetBranches.js);
//   3. otherwise the House's own home nearest the death — a house it keeps or a
//      settlement it holds (player/household.js, systems/holdings.js);
//   4. a ruler who died in a town: the heir is there;
//   5. else the nearest friendly town (not shut by plague, no price on the
//      House's head there), one with food on its stalls if one lies near.
//
// The heir sets out with food of their own, from somewhere real: rations from
// the House's larder when they arrive at home, then bought at the town's
// stalls with the heir's own (inherited) purse — the coin to the town, the
// food out of its store, at its price (Trading.buyGoods). Aboard ship, in a
// delve, in a cell or in service the heir takes over where they are.
// Tuned in data/afterlife.json heirArrival. Deterministic; draws no RNG.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Holdings } from '../systems/holdings.js';
import { Plague } from '../systems/plague.js';
import { Wanted } from '../systems/wanted.js';
import { Delves } from '../systems/delves.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Household } from './household.js';
import { Trading } from './playerEconomy.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const DEFAULTS = { enabled: true, provisionMeals: 4, foodSlack: 4, larderFirst: true };

export const HeirArrival = {
    config() {
        const src = DataLoader._gamedata && DataLoader._gamedata.afterlife && DataLoader._gamedata.afterlife.heirArrival;
        return { ...DEFAULTS, ...(src && typeof src === 'object' ? src : {}) };
    },

    _settlementAt(world, q, r) {
        if (!world || typeof world.getTile !== 'function' || !Number.isFinite(q) || !Number.isFinite(r)) return null;
        const t = world.getTile(q, r);
        const s = t && t.settlement;
        return s && _num(s.population, 1) > 0 ? s : null;
    },

    _dist(world, a, b) {
        return Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width || 0);
    },

    /** Would the heir be welcome in this town: not shut by plague, no price on the House's head? */
    _friendly(player, world, s) {
        if (!s) return false;
        if (!Plague.canEnter(player, world, s).ok) return false;
        if (s.kingdom != null && Wanted.isPosted(player, s.kingdom)) return false;
        return true;
    },

    _hasFood(player, s) {
        const ed = (player.constructor && player.constructor.FOOD_TYPES) || ['bread', 'grain'];
        for (const id of ed) if (SettlementMarket.tracks(id) && SettlementMarket.available(s, id) >= 1) return true;
        return false;
    },

    /**
     * Where the heir takes up the mantle → { q, r, why, name } (why: 'away',
     * 'branch', 'home', 'here', 'town') or null to stay where the ruler fell.
     */
    place(player, world, ctx = {}) {
        if (!player || !world || typeof world.getTile !== 'function') return null;
        const here = { q: player.q, r: player.r };
        // 1. Away on their years abroad
        const away = ctx.away;
        if (away && HeirArrival._settlementAt(world, away.q, away.r)) {
            return { q: away.q, r: away.r, why: 'away', name: HeirArrival._settlementAt(world, away.q, away.r).name || away.name || null };
        }
        // 2. A cadet branch's head, from the branch's seat
        const child = ctx.child;
        if (child && child.cadetOf && player.house && Array.isArray(player.house.cadets)) {
            const b = player.house.cadets.find(x => x && x.id === child.cadetOf);
            const seat = b && b.seat;
            if (seat && Number.isFinite(seat.q) && world.getTile(seat.q, seat.r)) {
                const s = HeirArrival._settlementAt(world, seat.q, seat.r);
                return { q: seat.q, r: seat.r, why: 'branch', name: (s && s.name) || b.name || null };
            }
        }
        // 3. The House's home nearest the death: a house it keeps, a settlement it holds
        const homes = [];
        for (const h of Household.homes(player)) {
            if (Number.isFinite(h.q) && Number.isFinite(h.r) && world.getTile(h.q, h.r)) homes.push({ q: h.q, r: h.r, name: h.town || h.name || null });
        }
        let held = [];
        try { held = Holdings.list(player, world) || []; } catch (e) { held = []; }
        for (const h of held) if (Number.isFinite(h.q) && Number.isFinite(h.r)) homes.push({ q: h.q, r: h.r, name: (h.settlement && h.settlement.name) || null });
        if (homes.length) {
            homes.sort((a, b) => HeirArrival._dist(world, here, a) - HeirArrival._dist(world, here, b) || a.q - b.q || a.r - b.r);
            const h = homes[0];
            return { q: h.q, r: h.r, why: 'home', name: h.name };
        }
        // 4. Died in a town: the heir is there
        if (HeirArrival._settlementAt(world, here.q, here.r)) return null;
        // 5. The nearest friendly town (one with food on its stalls, if one lies not much further)
        if (typeof world.getSettlementViews !== 'function') return null;
        const C = HeirArrival.config();
        const towns = [];
        for (const v of world.getSettlementViews()) {
            const s = HeirArrival._settlementAt(world, v.q, v.r);
            if (!s || !HeirArrival._friendly(player, world, s)) continue;
            towns.push({ q: v.q, r: v.r, s, d: HeirArrival._dist(world, here, v) });
        }
        if (!towns.length) return null;
        towns.sort((a, b) => a.d - b.d || a.q - b.q || a.r - b.r);
        const slack = Math.max(0, _num(C.foodSlack, 4));
        const fed = towns.find(t => t.d <= towns[0].d + slack && HeirArrival._hasFood(player, t.s));
        const t = fed || towns[0];
        return { q: t.q, r: t.r, why: 'town', name: t.s.name || null };
    },

    /** Set the heir down at (q, r): the journey of the late ruler ends, the land around is seen. */
    _moveTo(player, world, q, r) {
        player.q = q; player.r = r;
        player.prevQ = q; player.prevR = r;
        player.path = null;
        player.pathIndex = 0;
        player.isMoving = false;
        player.queuedPath = null;
        player.queuedPathIndex = 0;
        player.travelDestination = null;
        player.crossing = null;
        player.turnedAway = null;
        const t = world.getTile(q, r);
        if (t) { t.explored = true; t.visible = true; }
        // (the fog redrawn about the new place: only on a world with its tile grid)
        if (Array.isArray(world.tiles)) {
            if (typeof player.revealArea === 'function') player.revealArea(world, 4);
            if (typeof player.updateVisibility === 'function') player.updateVisibility(world, 4);
        }
    },

    /**
     * Food for the heir's packs, up to provisionMeals: the House's larder at
     * home first, then the town's stalls with the heir's own coin (cheapest
     * first, one at a time so each pays the climbing price). → { larder, bought, spent }
     */
    provision(player, world) {
        const C = HeirArrival.config();
        const want = Math.max(0, Math.floor(_num(C.provisionMeals, 4)));
        const out = { larder: 0, bought: 0, spent: 0 };
        if (!player || !world || typeof player.getFoodCount !== 'function') return out;
        if (player.getFoodCount() >= want) return out;
        // The House's larder, at a home of theirs
        if (C.larderFirst && player.household) {
            for (const h of Household.homes(player)) {
                const home = Household.home(player, h.key);
                if (!home || !Household.isHome(player, home)) continue;
                for (const g of Object.keys(home.larder || {})) {
                    while (player.getFoodCount() < want && _num(home.larder[g]) >= 1 && Household.isFood(g)) {
                        const r = Household.take(player, h.key, g, 1);
                        if (!r.success) break;
                        out.larder += r.n;
                    }
                }
            }
        }
        // The town's stalls, with the heir's own coin
        const s = HeirArrival._settlementAt(world, player.q, player.r);
        if (!s) return out;
        const tile = world.getTile(player.q, player.r);
        const ed = (player.constructor && player.constructor.FOOD_TYPES) || [];
        for (let guard = 0; guard < want * 2 && player.getFoodCount() < want; guard++) {
            let goods = [];
            try { goods = Trading.getAvailableGoods(s, tile, world) || []; } catch (e) { goods = []; }
            const pick = goods.filter(x => ed.includes(x.id) && x.quantity >= 1 && x.price <= _num(player.gold))
                .sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1))[0];
            if (!pick) break;
            const before = _num(player.gold);
            const r = Trading.buyGoods(player, pick, 1, s);
            if (!r || !r.success) break;
            out.bought++;
            out.spent = Math.round((out.spent + (before - _num(player.gold))) * 100) / 100;
        }
        return out;
    },

    /**
     * The heir takes up the mantle (Relationships.succeedAsHeir): set down at
     * their place, with food of their own. ctx: { child, away: {q, r, name} }.
     * → { moved, why, name, q, r, larder, bought, spent } or null when off.
     */
    arrive(player, world, ctx = {}) {
        const C = HeirArrival.config();
        if (!C.enabled || !player || !world || typeof world.getTile !== 'function') return null;
        // Aboard ship, in a delve, in a cell or in service: the heir takes over where they are
        const fixed = !!(player.boardedShip || player.jailState || player.indenturedServitude
            || (player.riverBoat && player.riverBoat.aboard) || Delves.active(player));
        const at = fixed ? null : HeirArrival.place(player, world, ctx);
        const from = { q: player.q, r: player.r };
        const moved = !!(at && (at.q !== player.q || at.r !== player.r));
        if (moved) HeirArrival._moveTo(player, world, at.q, at.r);
        const food = fixed ? { larder: 0, bought: 0, spent: 0 } : HeirArrival.provision(player, world);
        return { moved, why: at ? at.why : 'here', name: at ? at.name : null, q: player.q, r: player.r, from, ...food };
    },
};
