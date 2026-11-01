// ============================================
// LANDING PARTIES — what a ship's boat on open coast is good for
// ============================================
// The ship's boat can row ashore onto any coast hex, ferrying a boat-load a
// day where there is no port or jetty (systems/ships.js). This system makes
// those landings matter:
//
//   Beach runs   — goods rowed ashore on open coast skip the customs house:
//                  their realm bookings (systems/tradePolicy.js lots) are
//                  dropped, so they sell free of import duty and of any
//                  embargo. Contraband stays contraband (the black market
//                  and fences still take it, systems/underworld.js). The coast
//                  watch of the nearest realm may catch the boat: the goods
//                  seized, a fine to the crown, heat, maybe the cells.
//   Coast alarms — a realm whose coast was raided from the sea
//                  (player/coastalRaids.js) doubles its watch for a month:
//                  beach runs are caught more often and the next raid meets
//                  a readier garrison.
//   Landfall     — a colony founded from a landing party on unclaimed coast,
//                  supplied from the hold: cheaper than an overland colony and
//                  started with settlers and stores, but it has no quay — ships
//                  berth there only once a jetty (or a harbour) is built, and
//                  until then supplies come ashore a boat-load a day.
//   Sea reavers  — pirate captains (systems/pirates.js) put landing parties
//                  ashore on the player's coastal holdings near their havens.
//
// State: player.landings (saved through SaveLoad.EXTRA_PLAYER_FIELDS; ensure()
// backfills older saves). Every roll is a hash of the world seed, the day and
// the deed, or (the daily reaver tick) drawn inside Utils.withRng on its own
// seeded stream — the shared RNG stream is never moved. Explicit params, no
// DOM, no globals.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerInventory } from '../core/inventory.js';
import { Seasons } from '../world/seasons.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Colonization } from '../world/colonization.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Ships } from './ships.js';
import { TradePolicy } from './tradePolicy.js';
import { Underworld } from './underworld.js';
import { Ledger } from './ledger.js';
import { Holdings } from './holdings.js';
import { Pirates } from './pirates.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _day = (world) => _num(world && world.day);
const _label = (id) => String(id).replace(/_/g, ' ');
const FREE = '_free';
const LOG_CAP = 20;

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

/** A deterministic draw in [0, 1) for `key` (no RNG stream is touched). */
function _roll(world, key) {
    return ((Utils.hashStr(`${_seed(world)}:landing:${key}`) >>> 0) % 100000) / 100000;
}

/** Tunables; data/landings.json (if ever added to gamedata) overrides them section by section. */
const DEFAULTS = {
    run: {
        ap: 2,
        watchRadius: 6,        // a realm watches its coast this far from its nearest town
        catchBase: 0.08,
        perHeat: 0.004,
        perGuard: 0.035,       // × the nearest watching town's guard strength × closeness
        alarm: 0.2,            // the realm's coast is on alarm after a raid from the sea
        blockade: 0.12,        // its navy is out (a blockade)
        stealth: 0.02,
        wild: 0.03,            // no realm watches this coast
        min: 0.03, max: 0.8,
        fineShare: 0.5,
        arrest: 0.2,
        heatScale: 0.5,        // heat for a run that went unseen (rumour still travels)
        standing: 1,           // Thieves' Guild standing for a clean run
    },
    raid: {
        ap: 8,
        troopsPerShip: 8,      // soldiers one ship's boats put ashore in a day
        minStrength: 15,
        defenseShare: 0.35,    // a town caught unready by boats out of the sea
        alarmShare: 0.6,       // ...and one that has been warned
        alarmDays: 30,
        plunderPerHead: [0.4, 1.2],
        burnShare: 0.4,
        burnFood: 0.4,
        popLoss: 0.05,
        burnPopLoss: 0.08,
        karma: 4, burnKarma: 7,
        reputation: 15, burnReputation: 25, failReputation: 20,
        feud: 10, burnFeud: 16,
        memory: -10, burnMemory: -14,
        infamy: 6, burnInfamy: 10,
    },
    landfall: {
        ap: 6,
        discount: 0.4,         // off the colony's cost: the landing party brings its own
        supplies: 5,           // founding stores from the hold (one boat-load)
        settlers: 12,          // colonists who came over in the ship
        foodPerUnit: 1,
        reputationPerUnit: 0.5, // a well-supplied colony draws settlers (Colonization recruitment)
    },
    reavers: {
        radius: 14,            // hexes from a captain's haven to a holding
        chance: 0.015,         // a day, per captain in reach
        grudgeChance: 0.02,    // more from a captain with a grudge against you
        grudgeBelow: -20,
        cooldownDays: 14,      // per holding
        strengthShare: 0.6,
        marketLoss: 0.15,
        foodLoss: 0.2,
        popLoss: 0.02,
        unrest: 6,
        happiness: 4,
        repelRenown: 3,
        repelWeaken: 0.15,
    },
};

/** Goods that found a colony: food, timber and stone, tools. */
const FOUNDING_GOODS = ['wood', 'timber', 'stone', 'tools', 'iron', 'provisions'];

export const Landings = {
    // ──────────── CONFIG / STATE ────────────

    config() {
        const d = (DataLoader.get && DataLoader.get('landings')) || {};
        const out = {};
        for (const [k, v] of Object.entries(DEFAULTS)) out[k] = { ...v, ...(d[k] || {}) };
        return out;
    },

    _blank() {
        return {
            alarms: {}, log: [], reaverDay: {},
            stats: { runs: 0, runUnits: 0, caught: 0, raids: 0, raidsWon: 0, burned: 0, landfalls: 0, supplied: 0, reaversRepelled: 0, reaversSuffered: 0 },
        };
    },

    /** player.landings, created / backfilled. */
    ensure(player) {
        if (!player) return Landings._blank();
        const b = Landings._blank();
        let st = player.landings;
        if (!st || typeof st !== 'object') st = player.landings = b;
        if (!st.alarms || typeof st.alarms !== 'object') st.alarms = {};
        if (!st.reaverDay || typeof st.reaverDay !== 'object') st.reaverDay = {};
        if (!Array.isArray(st.log)) st.log = [];
        st.stats = { ...b.stats, ...(st.stats || {}) };
        return st;
    },

    /** Backfill after a load (older saves have none). */
    loadState(player) {
        if (player) Landings.ensure(player);
    },

    _log(player, world, text) {
        const st = Landings.ensure(player);
        st.log.push({ day: _day(world), text });
        if (st.log.length > LOG_CAP) st.log.splice(0, st.log.length - LOG_CAP);
    },

    // ──────────── THE COAST WATCH ────────────

    _settlements(world) {
        if (!world) return [];
        const all = typeof world.getSettlementViews === 'function' ? world.getSettlementViews()
            : (typeof world.getAllSettlements === 'function' ? world.getAllSettlements() : []);
        return (all || []).filter(s => s && Number.isFinite(s.q) && Number.isFinite(s.r));
    },

    _distance(world, q1, r1, q2, r2) {
        return world && world.width ? Hex.wrappingDistance(q1, r1, q2, r2, world.width) : Hex.distance(q1, r1, q2, r2);
    },

    /**
     * Who watches this stretch of coast: the realm whose land it is, or the
     * realm of the nearest town within watchRadius; and that town (whose
     * guard turns out), with how close it is (1 on its doorstep, toward 0 at
     * the edge of the watch). → { kingdom, settlement, closeness } or null.
     */
    coastWatch(world, q, r) {
        if (!world || typeof world.getTile !== 'function') return null;
        const R = Landings.config().run;
        const tile = world.getTile(q, r);
        let best = null;
        for (const v of Landings._settlements(world)) {
            const t = world.getTile(v.q, v.r);
            const s = (t && t.settlement) || v;
            if (!s || s.kingdom == null) continue;
            const d = Landings._distance(world, q, r, v.q, v.r);
            if (d > R.watchRadius) continue;
            // On a realm's own land, its own towns keep the watch
            if (tile && tile.kingdom != null && String(s.kingdom) !== String(tile.kingdom)) continue;
            if (!best || d < best.d) best = { s, d };
        }
        const kid = tile && tile.kingdom != null ? tile.kingdom : (best ? best.s.kingdom : null);
        const kingdom = kid != null && typeof world.getKingdom === 'function' ? world.getKingdom(kid) : null;
        if (!kingdom) return null;
        const settlement = best && String(best.s.kingdom) === String(kingdom.id) ? best.s : null;
        const closeness = settlement ? _clamp(1 - best.d / (R.watchRadius + 1), 0, 1) : 0;
        return { kingdom, settlement, closeness };
    },

    /** Raise a realm's coast alarm (after a raid from the sea). */
    raiseAlarm(player, world, kid, days = null) {
        if (!player || kid == null) return;
        const st = Landings.ensure(player);
        const until = _day(world) + _num(days, Landings.config().raid.alarmDays);
        st.alarms[kid] = Math.max(_num(st.alarms[kid]), until);
    },

    /** Is this realm's coast on alarm against you? */
    alarmed(player, world, kid) {
        const st = player && player.landings;
        return !!(st && st.alarms && kid != null && _num(st.alarms[kid]) > _day(world));
    },

    // ──────────── BEACH RUNS ────────────

    /** Where the player stands is open coast: no port, no jetty. */
    onOpenCoast(player, world) {
        if (!player || player.boardedShip || !world) return false;
        const tile = world.getTile(player.q, player.r);
        if (!tile || !tile.terrain || !tile.terrain.passable) return false;
        return !Ships.hasDock(world, player.q, player.r);
    },

    /** Anchored ships beside the player whose hold a boat can reach. */
    _anchored(player) {
        return Ships.getShipsWithHoldAccess(player).filter(s => s.status === 'anchored');
    },

    /**
     * Units of a good in a ship's hold that a beach run would hide from the
     * crown: those booked to a realm (they would owe import duty or be barred
     * by an embargo), or all of it when the good is contraband on this coast.
     */
    _hidden(ship, goodId, kingdom) {
        const held = _num(ship.cargo && ship.cargo[goodId]);
        if (!(held > 0)) return { held: 0, booked: 0, contraband: false };
        const row = (ship.lots && ship.lots[goodId]) || {};
        let booked = 0;
        for (const [k, v] of Object.entries(row)) if (k !== FREE && v > 0) booked += v;
        const contraband = !!kingdom && Underworld.contrabandStatus(kingdom, goodId) !== 'legal';
        return { held, booked: Math.min(held, Math.floor(booked + 1e-9)), contraband };
    },

    /** Chance the coast watch catches a run here. */
    runCatchChance(player, world, watch) {
        const R = Landings.config().run;
        if (!watch) return _clamp(R.wild, R.min, R.max);
        const k = watch.kingdom;
        let p = R.catchBase + Underworld.getHeat(player, k.id) * R.perHeat;
        if (watch.settlement) p += Underworld.guardStrength(watch.settlement, k) * R.perGuard * watch.closeness;
        if (Landings.alarmed(player, world, k.id)) p += R.alarm;
        if (KingdomNavy.isBlockaded(k)) p += R.blockade;
        p -= _num(player.skills && player.skills.stealth, 1) * R.stealth;
        p -= Underworld.traitBonus(player) * 0.5;
        return _clamp(p, R.min, R.max);
    },

    /**
     * What running `goodId` ashore from `shipId` here would do:
     * { ok, reason?, units, chance, watch, contraband, booked, value }.
     */
    runQuote(player, world, shipId, goodId) {
        if (!player || !world) return { ok: false, reason: 'No world.' };
        if (player.boardedShip) return { ok: false, reason: 'Row ashore first: the run is made from the beach.' };
        const ship = Landings._anchored(player).find(s => s.id === shipId);
        if (!ship) return { ok: false, reason: 'None of your ships lies at anchor beside you.' };
        if (!Landings.onOpenCoast(player, world)) return { ok: false, reason: 'A port or jetty has a customs house — run the goods ashore on open coast.' };
        const watch = Landings.coastWatch(world, player.q, player.r);
        const h = Landings._hidden(ship, goodId, watch && watch.kingdom);
        if (!(h.held > 0)) return { ok: false, reason: 'There is none of that aboard.' };
        if (!(h.booked > 0) && !h.contraband) return { ok: false, reason: 'Those goods owe no duty — unload them through the Ship\'s Hold.' };
        const allowance = Ships.getFerryAllowance(ship, world, player.q, player.r);
        const units = Math.min(h.held, allowance);
        if (!(units > 0)) return { ok: false, reason: 'The boat has made all its trips today.' };
        const value = Math.max(1, Math.floor(PlayerInventory.goodValue(goodId) || 10));
        return { ok: true, ship, units, chance: Landings.runCatchChance(player, world, watch), watch, contraband: h.contraband, booked: h.booked, value };
    },

    /** Goods in the anchored ships' holds a run could land: [{ shipId, shipName, goodId, ...quote }]. */
    runOptions(player, world) {
        const out = [];
        if (!Landings.onOpenCoast(player, world)) return out;
        for (const ship of Landings._anchored(player)) {
            for (const goodId of Object.keys(ship.cargo || {})) {
                const q = Landings.runQuote(player, world, ship.id, goodId);
                out.push({ shipId: ship.id, shipName: ship.name, goodId, ...q });
            }
        }
        return out;
    },

    /**
     * Run goods ashore past the customs house. Unseen, they come into the
     * packs with no realm's booking (no import duty, no embargo when sold);
     * caught, they are seized, a fine goes to the crown, heat, maybe arrest.
     * Costs AP; uses the boat's daily trips.
     */
    runAshore(player, world, shipId, goodId, qty = Infinity) {
        const q = Landings.runQuote(player, world, shipId, goodId);
        if (!q.ok) return { success: false, reason: q.reason };
        const R = Landings.config().run;
        if (_num(player.actionPoints) < R.ap) return { success: false, reason: `A beach run takes ${R.ap} action points.` };
        const ship = q.ship;
        const n = Math.max(1, Math.min(q.units, Math.floor(_num(qty, q.units))));
        const st = Landings.ensure(player);
        const kingdom = q.watch ? q.watch.kingdom : null;
        const day = _day(world);
        // Make sure the packs have room before anything leaves the hold
        if (!PlayerInventory.canAdd(player, goodId)) return { success: false, reason: PlayerInventory.fullMessage(player) };
        player.actionPoints -= R.ap;
        st.stats.runs++;
        Ships._useFerry(ship, world, n);
        const held = _num(ship.cargo[goodId]);
        // The bookings of what comes ashore are dropped (no customs house saw them)
        TradePolicy.takeLots(ship.lots || {}, goodId, n, held);
        ship.cargo[goodId] = held - n;
        if (ship.cargo[goodId] <= 0) delete ship.cargo[goodId];

        const caught = _roll(world, `run:${day}:${ship.id}:${goodId}:${st.stats.runs}`) < q.chance;
        const where = q.watch && q.watch.settlement ? q.watch.settlement.name : null;
        if (caught) {
            const fine = Math.min(Math.floor(_num(player.gold)), Math.floor(q.value * n * R.fineShare));
            if (fine > 0) {
                player.gold = _num(player.gold) - fine;
                if (kingdom) kingdom.treasury = _num(kingdom.treasury) + fine;
                Ledger.record(player, 'fines', -fine);
            }
            st.stats.caught++;
            TradePolicy.playerState(player).stats.caught++;
            let arrestText = '';
            if (kingdom) {
                Underworld.recordCrime(player, world, 'smuggling', { kingdom: kingdom.id, caught: true, q: player.q, r: player.r });
                if (q.watch.settlement && _roll(world, `arrest:${day}:${st.stats.runs}`) < R.arrest) {
                    const a = Underworld._arrest(player, world, q.watch.settlement, 'running goods ashore past the customs');
                    if (a) arrestText = ` ${a.text}`;
                }
            }
            const text = `The coast watch${kingdom ? ` of ${kingdom.name}` : ''} was waiting on the beach: ${n} ${_label(goodId)} seized${fine > 0 ? `, and a fine of ${fine}g` : ''}.${arrestText}`;
            Landings._log(player, world, text);
            return { success: true, caught: true, fine, seized: n, arrested: !!arrestText, text };
        }

        const added = PlayerInventory.addItem(player, goodId, n);
        if (added && added.success === false) {
            // No room after all: back aboard (unbooked now), trips spent
            ship.cargo[goodId] = _num(ship.cargo[goodId]) + n;
            return { success: false, reason: 'Your packs are full.' };
        }
        st.stats.runUnits += n;
        TradePolicy.playerState(player).stats.smuggled += n;
        if (kingdom) Underworld.recordCrime(player, world, 'smuggling', { kingdom: kingdom.id, scale: R.heatScale, q: player.q, r: player.r });
        const guild = Underworld.ensure(player).guild;
        if (guild && guild.member && R.standing) Underworld._gainStanding(player, world, R.standing);
        const tail = q.contraband
            ? ` They are contraband${kingdom ? ` in ${kingdom.name}` : ''}: the black market or a fence will take them.`
            : ' No customs house saw them: they sell free of import duty and of any embargo.';
        const text = `${n} ${_label(goodId)} came ashore by night${where ? ` below ${where}` : ''}, unseen.${tail}`;
        Landings._log(player, world, text);
        return { success: true, caught: false, landed: n, contraband: q.contraband, text };
    },

    // ──────────── LANDFALL COLONIES ────────────

    /** A colony founded from a landing that still has no jetty or harbour (systems/ships.js hasDock). */
    awaitsQuay(tile) {
        return Ships.awaitsQuay(tile);
    },

    _isFoundingGood(goodId) {
        return FOUNDING_GOODS.includes(goodId) || Seasons.priceGroup(goodId) === 'food';
    },

    /** Founding stores aboard a ship: [{ goodId, qty }]. */
    _foundingStores(ship) {
        return Object.entries(ship.cargo || {})
            .filter(([id, n]) => n > 0 && Landings._isFoundingGood(id))
            .map(([goodId, qty]) => ({ goodId, qty }));
    },

    /** The colony's cost when a landing party founds it. */
    landfallCost() {
        return Math.round(Colonization.COLONY_COST * (1 - Landings.config().landfall.discount));
    },

    /**
     * May the player found a colony from this landing? Standing ashore on
     * unclaimed coast with a ship at anchor beside them carrying a boat-load
     * of founding stores. → { ok, reason?, cost, ship, stores }
     */
    landfallQuote(player, world) {
        if (!player || !world) return { ok: false, reason: 'No world.' };
        const L = Landings.config().landfall;
        const cost = Landings.landfallCost();
        if (player.boardedShip) return { ok: false, reason: 'Row ashore first.', cost };
        const tile = world.getTile(player.q, player.r);
        if (!tile || !tile.terrain || !tile.terrain.passable) return { ok: false, reason: 'Stand on dry land.', cost };
        if (!Hex.neighbors(player.q, player.r).some(n => Ships.isWaterTile(world.getTile(n.q, n.r)))) {
            return { ok: false, reason: 'A landfall colony is founded on the coast.', cost };
        }
        if (tile.kingdom != null && tile.kingdom !== player.allegiance) return { ok: false, reason: 'This coast is claimed by a realm.', cost };
        const ships = Landings._anchored(player);
        if (!ships.length) return { ok: false, reason: 'Your ship must lie at anchor beside you.', cost };
        const check = Colonization.canPlayerFoundColony({ gold: Number.MAX_SAFE_INTEGER }, tile, world, player.q, player.r);
        if (!check.can) return { ok: false, reason: check.reason, cost };
        if (_num(player.gold) < cost) return { ok: false, reason: `Needs ${cost} gold.`, cost };
        const ship = ships.map(s => ({ s, n: Landings._foundingStores(s).reduce((a, e) => a + e.qty, 0) }))
            .sort((a, b) => b.n - a.n)[0];
        const allowance = Ships.getFerryAllowance(ship.s, world, player.q, player.r);
        if (ship.n < L.supplies) return { ok: false, reason: `The hold needs ${L.supplies} founding stores (food, timber, stone, tools).`, cost };
        if (allowance < L.supplies) return { ok: false, reason: 'The boat has no trips left today to land the stores.', cost };
        return { ok: true, cost, ship: ship.s, stores: Landings._foundingStores(ship.s) };
    },

    /**
     * Found a colony from the landing: the reduced cost, a boat-load of
     * founding stores off the hold into the new colony's stores, settlers
     * from the ship. It has no quay: until a jetty or harbour is built,
     * ships berth there only by boat (a boat-load a day).
     */
    foundLandfall(player, world, name = null, policyId = 'coexistence') {
        const q = Landings.landfallQuote(player, world);
        if (!q.ok) return { success: false, reason: q.reason };
        const L = Landings.config().landfall;
        if (_num(player.actionPoints) < L.ap) return { success: false, reason: `Founding a colony takes ${L.ap} action points.` };
        const tile = world.getTile(player.q, player.r);
        // Colonization charges its full price; the landing party's own stores pay the rest back
        const refund = Colonization.COLONY_COST - q.cost;
        player.gold = _num(player.gold) + refund;
        const res = Colonization.foundPlayerColony(player, tile, world, player.q, player.r, name, policyId);
        if (!res.success) {
            player.gold -= refund;
            return { success: false, reason: res.reason };
        }
        player.actionPoints -= L.ap;
        Ledger.record(player, 'holdings', -q.cost);
        const s = tile.settlement;
        s.colony.landfall = { day: _day(world), shipId: q.ship.id };
        s.population = _num(s.population) + L.settlers;
        // A boat-load of the founding stores comes ashore with them
        let left = L.supplies;
        const landed = {};
        for (const e of q.stores) {
            if (left <= 0) break;
            const n = Math.min(e.qty, left);
            Landings._intoColony(s, q.ship, e.goodId, n);
            landed[e.goodId] = n;
            left -= n;
        }
        Ships._useFerry(q.ship, world, L.supplies - left);
        const st = Landings.ensure(player);
        st.stats.landfalls++;
        const text = `${res.name} is founded where your boats came ashore: ${L.settlers} settlers and ${Object.entries(landed).map(([g, n]) => `${n} ${_label(g)}`).join(', ')} landed. Build a jetty there so ships can berth.`;
        Landings._log(player, world, text);
        return { success: true, name: res.name, landed, settlers: L.settlers, cost: q.cost, text };
    },

    /** Move `n` of a good out of a ship's hold into a colony's stores. */
    _intoColony(settlement, ship, goodId, n) {
        const L = Landings.config().landfall;
        const held = _num(ship.cargo && ship.cargo[goodId]);
        const take = Math.min(held, n);
        if (!(take > 0)) return 0;
        if (ship.lots) TradePolicy.takeLots(ship.lots, goodId, take, held);
        ship.cargo[goodId] = held - take;
        if (ship.cargo[goodId] <= 0) delete ship.cargo[goodId];
        if (Seasons.priceGroup(goodId) === 'food') {
            if (!settlement.economy) settlement.economy = { food: 0 };
            settlement.economy.food = _num(settlement.economy.food) + take * L.foodPerUnit;
        }
        if (SettlementMarket.tracks(goodId)) SettlementMarket.add(settlement, goodId, take);
        const rec = settlement.colony && settlement.colony.recruitment;
        if (rec) rec.reputation = _clamp(_num(rec.reputation) + take * L.reputationPerUnit, 0, 100);
        return take;
    },

    /** The player's colony on their hex, with a ship whose hold they can reach. → { ok, reason?, settlement, ships } */
    supplyQuote(player, world) {
        if (!player || !world || player.boardedShip) return { ok: false, reason: 'Go ashore first.' };
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        if (!s || !s.colony || !s.colony.isPlayerColony) return { ok: false, reason: 'Stand in one of your colonies.' };
        const ships = Ships.getShipsWithHoldAccess(player);
        if (!ships.length) return { ok: false, reason: 'None of your ships lies beside the colony.' };
        return { ok: true, settlement: s, tile, ships };
    },

    /**
     * Land goods from a ship's hold into the colony's stores (food to its
     * granary, every good to its market), a boat-load a day until it has a
     * jetty or harbour. Word of a well-supplied colony draws settlers.
     */
    supplyColony(player, world, shipId, goodId, qty = Infinity) {
        const q = Landings.supplyQuote(player, world);
        if (!q.ok) return { success: false, reason: q.reason };
        const ship = q.ships.find(s => s.id === shipId);
        if (!ship) return { success: false, reason: "You cannot reach that ship's hold from here." };
        const held = _num(ship.cargo && ship.cargo[goodId]);
        if (!(held > 0)) return { success: false, reason: 'There is none of that aboard.' };
        const allowance = Ships.getFerryAllowance(ship, world, player.q, player.r);
        const n = Math.min(held, allowance, Math.max(1, Math.floor(_num(qty, held))));
        if (!(n > 0)) return { success: false, reason: 'The boat has made all its trips today — a jetty has no such limit.' };
        const took = Landings._intoColony(q.settlement, ship, goodId, n);
        if (allowance !== Infinity) Ships._useFerry(ship, world, took);
        Landings.ensure(player).stats.supplied += took;
        return { success: true, landed: took, text: `${took} ${_label(goodId)} landed into ${q.settlement.name}'s stores.` };
    },

    // ──────────── SEA REAVERS ────────────

    _reaverRng(world) {
        return Utils.seededRandom(((Utils.hashStr(`${_seed(world)}:reavers:${_day(world)}`) >>> 0) % 233279) + 1);
    },

    /**
     * One day: pirate captains at large put landing parties ashore on the
     * player's coastal holdings near their havens. A holding's defence
     * (Holdings.defenseRating) beats them off or they burn stores, carry off
     * food and people. Own seeded stream. → { notices, raids }
     */
    processDay(world, player) {
        const out = { notices: [], raids: [] };
        if (!world || !player || !player.seaRoving || typeof world.getTile !== 'function') return out;
        const st = Landings.ensure(player);
        const holdings = Holdings.list(player, world).filter(h => h.settlement && Ships.isPortTile(world, h.q, h.r));
        if (!holdings.length) return out;
        Utils.withRng(Landings._reaverRng(world), () => Landings._reavers(world, player, st, holdings, out));
        return out;
    },

    _reavers(world, player, st, holdings, out) {
        const R = Landings.config().reavers;
        const day = _day(world);
        for (const cap of Pirates.atLarge(player)) {
            const haven = Pirates.haven(player, cap.havenId);
            if (!haven) continue;
            const near = holdings.filter(h => Landings._distance(world, h.q, h.r, haven.q, haven.r) <= R.radius
                && day - _num(st.reaverDay[h.key], -999) >= R.cooldownDays);
            if (!near.length) continue;
            const p = R.chance + (_num(cap.regard) <= R.grudgeBelow ? R.grudgeChance : 0);
            if (!(Utils.random() < p)) continue;
            const ref = near[Math.floor(Utils.random() * near.length)];
            Landings._reaverRaid(world, player, st, cap, ref, out);
        }
    },

    _reaverRaid(world, player, st, cap, ref, out) {
        const R = Landings.config().reavers;
        const s = ref.settlement;
        st.reaverDay[ref.key] = _day(world);
        const attack = _num(cap.strength, 10) * R.strengthShare * (0.8 + Utils.random() * 0.5);
        const defense = Holdings.defenseRating(s);
        const who = `${cap.name}${cap.epithet ? ` ${cap.epithet}` : ''}`;
        if (defense >= attack) {
            st.stats.reaversRepelled++;
            cap.strength = Math.max(1, Math.round(_num(cap.strength) * (1 - R.repelWeaken) * 100) / 100);
            player.renown = _num(player.renown) + R.repelRenown;
            const text = `${who}'s boats came ashore at ${s.name} by night — and were driven back into the sea.`;
            Landings._log(player, world, text);
            out.raids.push({ q: ref.q, r: ref.r, repelled: true, text });
            out.notices.push({ icon: '🛡️', title: 'Reavers Repelled', text, type: 'success' });
            return;
        }
        st.stats.reaversSuffered++;
        if (s.market) SettlementMarket.loot(s, R.marketLoss);
        if (s.economy) s.economy.food = Math.floor(_num(s.economy.food) * (1 - R.foodLoss));
        s.population = Math.max(10, Math.round(_num(s.population) * (1 - R.popLoss)));
        if (typeof s.happiness === 'number') s.happiness = _clamp(s.happiness - R.happiness, 0, 100);
        const h = Holdings.ensure(s);
        h.unrest = _clamp(_num(h.unrest) + R.unrest, 0, 100);
        cap.loot = _num(cap.loot) + Math.round(_num(s.population) * 0.2);
        const text = `${who}'s reavers landed at ${s.name}: stores burned, people carried off to the ships. Walls, a watchtower and a garrison keep them out.`;
        Landings._log(player, world, text);
        out.raids.push({ q: ref.q, r: ref.r, repelled: false, text });
        out.notices.push({ icon: '🏴‍☠️', title: 'Sea Reavers Landed', text, type: 'error' });
    },

    // ──────────── SUMMARY ────────────

    summary(player, world) {
        const st = Landings.ensure(player);
        const alarms = Object.entries(st.alarms)
            .filter(([, until]) => _num(until) > _day(world))
            .map(([kid, until]) => {
                const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(kid) : null;
                return { kingdomId: kid, name: (k && k.name) || kid, until };
            });
        return { stats: { ...st.stats }, alarms, log: st.log.slice(-8) };
    },
};
