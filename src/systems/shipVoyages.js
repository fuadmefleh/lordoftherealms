// ============================================
// SHIP VOYAGES — provisions, voyages that take real days, events at sea
// ============================================
// Mixed into Ships (systems/ships.js) with Object.assign, so `this` is the
// Ships object. Kept in its own module to keep ships.js readable; it imports
// nothing from ships.js (no cycle).
//
//   Provisions — ships away from port feed their crew from the hold
//     (settings.provisions). A hungry crew loses morale, then scurvy breaks
//     out aboard (Ailments), then a broken crew deserts (Ships._payCrews).
//   Voyages — startVoyage(player, world, shipId, q, r, name) puts the player
//     aboard and plots a sea route (breadth-first over water). Each daily tick
//     (Ships.processDaily → _voyageDay) sails getSailingSpeed hexes along it
//     (less in a storm, none while becalmed or lying to), so the normal day
//     passes at sea: wages, upkeep, storms, interception, scurvy.
//   Events — a data-driven table (data/ships.json → voyageEvents) of at-sea
//     events with choices. One may come up each day; it waits on
//     resolveVoyageEvent, or its default choice is taken on the next day.
//
// All state lives on the ship (ship.voyage, ship.lastVoyage, ship.hungryDays,
// ship.rationCarry), so it saves with player.ships; Ships.restoreFromSave
// backfills it.

import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Economy } from '../world/economy.js';
import { Quests } from './quests.js';
import { Traits } from './traits.js';
import { Underworld } from './underworld.js';
import { Ailments } from './ailments.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A number or a [lo, hi] range, rolled. */
function _roll(v) {
    if (Array.isArray(v)) return Utils.randInt(Math.min(v[0], v[1]), Math.max(v[0], v[1]));
    return _num(v);
}

/**
 * The player's seafaring record (player.voyageStats: voyages made, days at
 * sea, events met, the longest voyage) — shown in Deeds & Records. Created on
 * demand; saved with the player.
 */
function _voyageStat(player, key, n = 1, max = false) {
    if (!player) return;
    const s = player.voyageStats && typeof player.voyageStats === 'object' ? player.voyageStats : (player.voyageStats = {});
    s[key] = max ? Math.max(_num(s[key]), n) : _num(s[key]) + n;
}

export const VoyageMethods = {

    /* ── Settings ────────────────────────────────────────────── */

    _getProvisionSettings() {
        return {
            item: 'food',
            foods: ['food', 'preserved_fish', 'bread', 'grain', 'fish'],
            sailorsPerRation: 4,
            chandlerMarkup: 1.5,
            minPrice: 6,
            hungerMoraleLoss: 8,
            scurvyAfterHungryDays: 3,
            ...(this._getSettings().provisions || {}),
        };
    },

    _getVoyageSettings() {
        return {
            eventChance: 0.3,
            stormProgress: 0.5,
            logLength: 40,
            maxRouteNodes: 60000,
            ...(this._getSettings().voyage || {}),
        };
    },

    _getVoyageEvents() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && Array.isArray(DataLoader.ships.voyageEvents))
            ? DataLoader.ships.voyageEvents : [];
    },

    /* ── Provisions ──────────────────────────────────────────── */

    /** Food in the hold the crew can eat (units). */
    getProvisions(ship) {
        const cargo = (ship && ship.cargo) || {};
        let n = 0;
        for (const f of this._getProvisionSettings().foods) n += _num(cargo[f]);
        return n;
    },

    /** Food units the crew eats in a day away from port (fractional). */
    getDailyRations(ship) {
        return this.getCrew(ship) / Math.max(1, this._getProvisionSettings().sailorsPerRation);
    },

    /** Whole days the hold can feed the crew; Infinity with nobody aboard. */
    getProvisionDays(ship) {
        const need = this.getDailyRations(ship);
        if (!(need > 0)) return Infinity;
        return Math.floor(this.getProvisions(ship) / need);
    },

    /**
     * Units of provisions to buy so the hold feeds the crew for `days`. The
     * captain eats from the hold too once their own packs run dry, so their
     * ration is counted (unless `captain: false`) — for every day, or, given
     * the `player`, only for the days their pack food won't cover.
     */
    provisionsNeeded(ship, days, { captain = true, player = null } = {}) {
        let captainDays = 0;
        if (captain) {
            const packs = player && typeof player.getFoodCount === 'function' ? player.getFoodCount() : 0;
            captainDays = Math.max(0, days - packs);
        }
        return Math.max(0, Math.ceil(days * this.getDailyRations(ship) + captainDays) - this.getProvisions(ship));
    },

    /** What a port's ship's chandler charges for one unit of provisions. */
    provisionPrice(world, q, r) {
        const P = this._getProvisionSettings();
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        const goods = Economy._goods();
        const food = goods[String(P.item).toUpperCase()];
        let price = P.minPrice;
        if (food && tile && tile.settlement) {
            price = Math.max(price, Math.ceil(Economy.marketPrice(food, tile.settlement, tile, world) * P.chandlerMarkup));
        }
        return price;
    },

    /** Buy provisions at a port into a docked ship's hold. */
    buyProvisions(player, world, shipId, units) {
        const ship = this._getShipAtPort(player, world, shipId);
        if (!ship) return { success: false, message: 'Your ship must be docked at this port.' };
        const closed = this._closedPortMessage(world, player.q, player.r);
        if (closed) return { success: false, message: closed };
        const price = this.provisionPrice(world, player.q, player.r);
        const n = Math.min(Math.floor(units), this.getCargoFree(ship), Math.floor((player.gold || 0) / price));
        if (!(n > 0)) {
            return { success: false, message: this.getCargoFree(ship) <= 0 ? 'The hold is full.' : `You cannot afford provisions (${price}g a unit).` };
        }
        const cost = n * price;
        player.gold -= cost;
        const item = this._getProvisionSettings().item;
        if (!ship.cargo) ship.cargo = {};
        ship.cargo[item] = (ship.cargo[item] || 0) + n;
        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + cost;
        }
        return {
            success: true, ship, bought: n, cost, price,
            message: `Stowed ${n} provisions aboard ${ship.name} for ${cost}g — enough for ${this.getProvisionDays(ship)} days.`,
        };
    },

    /** Take up to `units` of food out of the hold, in the provisions order. */
    _eatFromHold(ship, units) {
        let left = units;
        for (const f of this._getProvisionSettings().foods) {
            if (left <= 0) break;
            const have = _num(ship.cargo && ship.cargo[f]);
            if (have <= 0) continue;
            const take = Math.min(have, left);
            ship.cargo[f] = have - take;
            if (ship.cargo[f] <= 0) delete ship.cargo[f];
            left -= take;
        }
        return units - left;
    },

    /**
     * The captain eats a day's ration from the hold of the ship they're
     * aboard when their own packs are empty. Returns the food eaten, or null.
     */
    feedCaptain(player) {
        const ship = player && player.boardedShip != null ? this.getShipById(player, player.boardedShip) : null;
        if (!ship) return null;
        const food = this._getProvisionSettings().foods.find(f => _num(ship.cargo && ship.cargo[f]) > 0);
        if (!food) return null;
        ship.cargo[food] -= 1;
        if (ship.cargo[food] <= 0) delete ship.cargo[food];
        return food;
    },

    /** Put `units` of provisions into the hold, as far as it has room. */
    _stowProvisions(ship, units) {
        const n = Math.min(units, this.getCargoFree(ship));
        if (n <= 0) return 0;
        const item = this._getProvisionSettings().item;
        if (!ship.cargo) ship.cargo = {};
        ship.cargo[item] = (ship.cargo[item] || 0) + n;
        return n;
    },

    /**
     * Every crew away from port eats its rations from the hold. A crew in
     * harbour eats ashore (its wages cover it). Short rations cost morale;
     * days of them bring scurvy aboard.
     * @returns {object[]} one report per ship that ate or went hungry
     */
    _feedCrews(player, world) {
        const P = this._getProvisionSettings();
        const reports = [];
        for (const ship of player.ships || []) {
            const away = ['at_sea', 'anchored', 'moving'].includes(ship.status);
            if (!away || this.getCrew(ship) <= 0) {
                ship.hungryDays = 0;
                ship.rationCarry = 0;
                continue;
            }
            const carry = _num(ship.rationCarry) + this.getDailyRations(ship);
            const want = Math.floor(carry);
            ship.rationCarry = Math.round((carry - want) * 1000) / 1000;
            const eaten = want > 0 ? this._eatFromHold(ship, want) : 0;
            const short = want - eaten;
            const rep = { shipId: ship.id, name: ship.name, eaten, short, hungryDays: 0, outbreak: false, daysLeft: this.getProvisionDays(ship) };
            if (short > 0) {
                ship.hungryDays = _num(ship.hungryDays) + 1;
                this._ensureCrew(ship);
                this._setMorale(ship, ship.morale - Math.max(1, Math.round(P.hungerMoraleLoss * short / want)));
                if (ship.hungryDays >= P.scurvyAfterHungryDays) {
                    rep.outbreak = Ailments.startCrewOutbreak(player, ship, 'scurvy');
                }
            } else if (want > 0) {
                ship.hungryDays = 0;
            }
            rep.hungryDays = _num(ship.hungryDays);
            if (eaten > 0 || short > 0) reports.push(rep);
        }
        return reports;
    },

    /* ── Sea routes ──────────────────────────────────────────── */

    /**
     * Breadth-first search over open water from (fromQ, fromR). Ports — land
     * hexes with a settlement — end a route but are never sailed through.
     * Stops early once `target` is reached. Returns Map "q,r" → node
     * { q, r, d, prev }.
     */
    _seaSearch(world, fromQ, fromR, target = null) {
        const W = world.width || 0;
        const H = world.height || 0;
        const start = { q: fromQ, r: fromR, d: 0, prev: null };
        const seen = new Map([[`${fromQ},${fromR}`, start]]);
        const queue = [start];
        const max = this._getVoyageSettings().maxRouteNodes;
        for (let i = 0; i < queue.length && seen.size < max; i++) {
            const cur = queue[i];
            if (i > 0 && !this.isWaterTile(world.getTile(cur.q, cur.r))) continue;
            for (const n of Hex.neighbors(cur.q, cur.r)) {
                const q = W ? Hex.wrapQ(n.q, W) : n.q;
                const r = n.r;
                if (H && (r < 0 || r >= H)) continue;
                const k = `${q},${r}`;
                if (seen.has(k)) continue;
                const t = world.getTile(q, r);
                if (!t) continue;
                const isTarget = !!target && q === target.q && r === target.r;
                if (!this.isWaterTile(t) && !(isTarget || (!target && t.settlement))) continue;
                const node = { q, r, d: cur.d + 1, prev: cur };
                seen.set(k, node);
                if (isTarget) return seen;
                queue.push(node);
            }
        }
        return seen;
    },

    /** The hexes from (from) to (to) by sea, excluding the start; null when no route. */
    seaPath(world, from, to) {
        const tq = world.width ? Hex.wrapQ(to.q, world.width) : to.q;
        const seen = this._seaSearch(world, from.q, from.r, { q: tq, r: to.r });
        let node = seen.get(`${tq},${to.r}`);
        if (!node || node.d === 0) return null;
        const path = [];
        while (node && node.prev) { path.push({ q: node.q, r: node.r }); node = node.prev; }
        return path.reverse();
    },

    /** Ports reachable by sea from (q, r): [{ q, r, name, type, distance }], nearest first. */
    seaRoutes(world, q, r) {
        const out = [];
        for (const node of this._seaSearch(world, q, r).values()) {
            if (node.d === 0) continue;
            const t = world.getTile(node.q, node.r);
            if (!t || !t.settlement || !this.isPortTile(world, node.q, node.r)) continue;
            out.push({ q: node.q, r: node.r, name: t.settlement.name, type: t.settlement.type, distance: node.d });
        }
        return out.sort((a, b) => a.distance - b.distance);
    },

    /** Days a ship takes to sail `distance` hexes with this player aboard. */
    voyageDays(player, ship, distance) {
        return Math.max(1, Math.ceil(distance / this.getSailingSpeed(player, ship)));
    },

    /* ── Voyages ─────────────────────────────────────────────── */

    /** The ship the player is aboard on a voyage, or null. */
    getVoyageShip(player) {
        if (!player || player.boardedShip == null) return null;
        const ship = this.getShipById(player, player.boardedShip);
        return ship && ship.voyage ? ship : null;
    },

    /** The voyage in progress, or null. */
    getVoyage(player) {
        const ship = this.getVoyageShip(player);
        return ship ? ship.voyage : null;
    },

    _voyageLog(ship, icon, text, world) {
        const v = ship.voyage || ship.lastVoyage;
        if (!v) return;
        if (!Array.isArray(v.log)) v.log = [];
        v.log.push({ day: world ? world.day || 0 : 0, icon, text });
        const cap = this._getVoyageSettings().logLength;
        if (v.log.length > cap) v.log.splice(0, v.log.length - cap);
    },

    /**
     * Board a ship docked where the player stands and set out for a port.
     * No gold changes hands up front: upkeep, wages and rations are paid
     * day by day on the way.
     */
    startVoyage(player, world, shipId, destQ, destR, destName) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        // From the helm on open water (after heaving to or an expedition): make for port
        const atHelm = player.boardedShip === ship.id && !ship.voyage && ship.status !== 'docked';
        if (!atHelm) {
            if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked.' };
            if (ship.q !== player.q || ship.r !== player.r) return { success: false, message: 'You must be aboard — go to where she is docked.' };
            if (player.boardedShip) return { success: false, message: 'You are already aboard a ship.' };
        } else {
            ship.q = player.q;
            ship.r = player.r;
        }
        const noCrew = this.crewSailReason(ship);
        if (noCrew) return { success: false, message: noCrew };
        if (ship.q === destQ && ship.r === destR) return { success: false, message: 'You are already there.' };
        const route = world ? this.seaPath(world, ship, { q: destQ, r: destR }) : null;
        if (!route) return { success: false, message: `There is no sea route from here to ${destName}.` };

        const days = this.voyageDays(player, ship, route.length);
        const tile = world.getTile(ship.q, ship.r);
        const from = (tile && tile.settlement && tile.settlement.name) || ship.dockedAt || (atHelm ? 'the open sea' : 'port');
        ship.status = 'at_sea';
        ship.dockedAt = null;
        ship.voyage = {
            destQ, destR, destName, fromName: from, fromQ: ship.q, fromR: ship.r,
            route: route.map(h => [h.q, h.r]),
            step: 0, day: 0, estDays: days, startDay: world.day || 0,
            delay: 0, pending: null, log: [],
        };
        delete ship.lastVoyage;
        player.boardedShip = ship.id;
        player.path = null;
        player.isMoving = false;
        player.queuedPath = null;
        const food = this.getProvisionDays(ship);
        this._voyageLog(ship, '⛵', `Set sail from ${from} for ${destName}: ${route.length} leagues, about ${days} day${days === 1 ? '' : 's'}.`, world);
        const warn = food < days ? ` Provisions for only ${food} day${food === 1 ? '' : 's'} — the crew will go hungry.` : '';
        return {
            success: true, ship, days, distance: route.length,
            message: `${ship.name} sets sail for ${destName} — about ${days} day${days === 1 ? '' : 's'} at sea.${warn}`,
        };
    },

    /** Stop the voyage where the ship is and take the helm yourself (you stay aboard). */
    heaveTo(player, world = null) {
        const ship = this.getVoyageShip(player);
        if (!ship) return { success: false, message: 'You are not on a voyage.' };
        if (ship.voyage.pending) this.resolveVoyageEvent(player, world, null);
        this._endVoyage(ship, world, `Hove to and took the helm, ${ship.voyage.destName} still over the horizon.`);
        return { success: true, ship, message: `${ship.name} heaves to. You have the helm — sail on yourself, or row ashore.` };
    },

    /** Close a voyage, keeping its log as lastVoyage. */
    _endVoyage(ship, world, text, icon = '⚓') {
        const v = ship.voyage;
        if (!v) return;
        this._voyageLog(ship, icon, text, world);
        ship.lastVoyage = { destName: v.destName, fromName: v.fromName, days: v.day, log: v.log };
        delete ship.voyage;
    },

    /** Where the voyage expects the ship to be: the last hex sailed, or the port of departure. */
    _voyagePos(ship) {
        const v = ship.voyage;
        if (v.step > 0) {
            const [q, r] = v.route[Math.min(v.step, v.route.length) - 1];
            return { q, r };
        }
        return { q: v.fromQ, r: v.fromR };
    },

    /**
     * A day of the voyage: settle a waiting event by its default, sail on
     * (re-plotting if the player steered off the route), make port at the
     * end, or roll an event at sea. Called from Ships.processDaily.
     * @param {object|null} storm — today's storm at the ship ({ danger }) or null
     */
    _voyageDay(player, world, storm = null) {
        // A voyage only goes on with the player aboard
        for (const s of player.ships || []) {
            if (s.voyage && player.boardedShip !== s.id) this._endVoyage(s, world, 'The voyage was abandoned.');
        }
        const ship = this.getVoyageShip(player);
        if (!ship || !world) return null;
        const v = ship.voyage;
        const cfg = this._getVoyageSettings();
        v.day = _num(v.day) + 1;
        _voyageStat(player, 'daysAtSea');
        const out = { shipId: ship.id, name: ship.name, destName: v.destName, day: v.day, estDays: v.estDays, moved: 0, arrived: false, autoResolved: null, event: null, lost: false };

        if (v.pending) out.autoResolved = this.resolveVoyageEvent(player, world, null);
        if (!ship.voyage) return out;

        // Steered off the route by hand: plot a new one from here
        const expected = this._voyagePos(ship);
        const here = { q: player.q, r: player.r };
        if (expected.q !== here.q || expected.r !== here.r) {
            const route = this.seaPath(world, here, { q: v.destQ, r: v.destR });
            if (!route) {
                this._endVoyage(ship, world, `No sea route from here to ${v.destName}. You have the helm.`, '🧭');
                out.lost = true;
                return out;
            }
            v.route = route.map(h => [h.q, h.r]);
            v.step = 0;
            v.fromQ = here.q;
            v.fromR = here.r;
        }

        let hexes = this.getSailingSpeed(player, ship);
        if (v.delay > 0) {
            v.delay -= 1;
            hexes = 0;
            this._voyageLog(ship, '⏸️', 'Lay to all day.', world);
        } else if (storm) {
            hexes = Math.floor(hexes * cfg.stormProgress);
        }
        const before = v.step;
        v.step = Math.min(v.route.length, v.step + hexes);
        out.moved = v.step - before;
        if (out.moved > 0) {
            const [q, r] = v.route[v.step - 1];
            player.q = q; player.r = r;
            ship.q = q; ship.r = r;
        }

        // An expedition (systems/discovery.js) ends out at sea, the player at the helm
        if (v.step >= v.route.length && v.expedition) {
            ship.status = 'at_sea';
            out.expeditionDone = true;
            this._endVoyage(ship, world, `Reached ${v.destName} after ${v.day} day${v.day === 1 ? '' : 's'}. You have the helm.`, '🧭');
            Traits.recordDeed(player, 'seafaring', 1);
            _voyageStat(player, 'voyages');
            _voyageStat(player, 'longest', v.day, true);
            return out;
        }
        if (v.step >= v.route.length) {
            ship.status = 'docked';
            ship.dockedAt = v.destName;
            ship.q = v.destQ; ship.r = v.destR;
            player.q = v.destQ; player.r = v.destR;
            player.boardedShip = null;
            out.arrived = true;
            this._endVoyage(ship, world, `Made port at ${v.destName} after ${v.day} day${v.day === 1 ? '' : 's'} at sea.`);
            Traits.recordDeed(player, 'seafaring', 1);
            _voyageStat(player, 'voyages');
            _voyageStat(player, 'longest', v.day, true);
            return out;
        }

        const left = this.voyageDays(player, ship, v.route.length - v.step);
        if (out.moved > 0) {
            this._voyageLog(ship, '🌊', `Made ${out.moved} league${out.moved === 1 ? '' : 's'}${storm ? ' against the storm' : ''}; ${left} day${left === 1 ? '' : 's'} to ${v.destName}.`, world);
        }
        out.daysLeft = left;

        if (Utils.random() < cfg.eventChance) {
            const event = this._pickVoyageEvent(player, ship);
            if (event) {
                v.pending = { id: event.id, day: world.day || 0 };
                _voyageStat(player, 'events');
                this._voyageLog(ship, event.icon || '❗', `${event.title}: ${event.text}`, world);
                out.event = this.describeVoyageEvent(player);
            }
        }
        return out;
    },

    /**
     * Write the rest of the day's tick (storm, interception, rations, wages,
     * desertion) for the voyage ship into its log, and hand the day's log
     * lines back on the voyage report. `notable` marks a day worth stopping
     * for: a storm, a fight, an event, hunger or desertion.
     */
    _logVoyageDay(player, world, out, day) {
        const ship = this.getShipById(player, out.shipId);
        if (!ship) return;
        const id = ship.id;
        let notable = !!out.event || !!out.lost;
        for (const s of day.stormReports || []) {
            if (s.shipId !== id) continue;
            notable = true;
            let t = `Caught in a ${String(s.weather).replace(/_/g, ' ')} (hull −${s.damage}%).`;
            if (s.cargoLost) t += ` ${s.cargoLost.qty} ${s.cargoLost.good} washed overboard.`;
            if (s.crewLost) t += ' A sailor was lost overboard.';
            this._voyageLog(ship, '⛈️', t, world);
        }
        for (const ic of day.interceptions || []) {
            if (ic.shipId !== id) continue;
            notable = true;
            this._voyageLog(ship, '⚓', ic.text, world);
        }
        for (const p of day.provisions || []) {
            if (p.shipId !== id) continue;
            if (p.short > 0) {
                notable = true;
                this._voyageLog(ship, '🍞', `Short rations: the hold is empty (${p.hungryDays} hungry day${p.hungryDays === 1 ? '' : 's'}).${p.outbreak ? ' Scurvy has broken out.' : ''}`, world);
            } else if (Number.isFinite(p.daysLeft) && p.daysLeft <= 3) {
                this._voyageLog(ship, '🍞', `Provisions for ${p.daysLeft} more day${p.daysLeft === 1 ? '' : 's'}.`, world);
            }
        }
        const crew = day.crew || {};
        if (crew.paid === false) {
            notable = true;
            this._voyageLog(ship, '👥', `No wages today (${crew.wages}g owed). The crew sours.`, world);
        }
        for (const d of crew.deserted || []) {
            if (d.shipId !== id) continue;
            notable = true;
            this._voyageLog(ship, '👥', `${d.count} sailor${d.count === 1 ? '' : 's'} deserted — morale had collapsed.`, world);
        }
        const v = ship.voyage || ship.lastVoyage;
        const today = world ? world.day || 0 : 0;
        out.log = v && Array.isArray(v.log) ? v.log.filter(e => e.day === today) : [];
        out.notable = notable || out.arrived || !!out.expeditionDone;
        out.provisionDays = this.getProvisionDays(ship);
        out.morale = this.getMorale(ship);
        out.crew = this.getCrew(ship);
        out.condition = ship.condition;
    },

    /* ── Events at sea ───────────────────────────────────────── */

    getVoyageEvent(id) {
        return this._getVoyageEvents().find(e => e.id === id) || null;
    },

    /** Why a requirement block isn't met here, or null when it is. */
    _voyageReqReason(player, ship, req) {
        if (!req) return null;
        const crew = this.getCrew(ship);
        if (req.crew && crew < req.crew) return `Needs ${req.crew} hands`;
        if (req.minCrew && crew < req.minCrew) return `Needs ${req.minCrew} hands`;
        if (Number.isFinite(req.maxMorale) && this.getMorale(ship) > req.maxMorale) return 'The crew is content';
        if (req.gold && (player.gold || 0) < req.gold) return `Needs ${req.gold}g`;
        if (req.goldPerCrew && (player.gold || 0) < req.goldPerCrew * crew) return `Needs ${req.goldPerCrew * crew}g`;
        if (req.provisions && this.getProvisions(ship) < req.provisions) return `Needs ${req.provisions} provisions`;
        if (req.cargo && this.getCargoUsed(ship) <= 0) return 'Needs cargo aboard';
        return null;
    },

    _pickVoyageEvent(player, ship) {
        const pool = this._getVoyageEvents().filter(e => !this._voyageReqReason(player, ship, e.requires));
        const total = pool.reduce((s, e) => s + Math.max(0, _num(e.weight, 1)), 0);
        if (!(total > 0)) return null;
        let roll = Utils.random() * total;
        for (const e of pool) {
            roll -= Math.max(0, _num(e.weight, 1));
            if (roll < 0) return e;
        }
        return pool[pool.length - 1];
    },

    /** The waiting event and its choices: { id, icon, title, text, choices: [{ id, label, available, why }] } or null. */
    describeVoyageEvent(player) {
        const ship = this.getVoyageShip(player);
        const pending = ship && ship.voyage.pending;
        const def = pending ? this.getVoyageEvent(pending.id) : null;
        if (!def) return null;
        return {
            id: def.id, icon: def.icon || '❗', title: def.title, text: def.text, default: def.default,
            choices: (def.choices || []).map(c => {
                const why = this._voyageReqReason(player, ship, c.requires);
                return { id: c.id, label: c.label, available: !why, why };
            }),
        };
    },

    /**
     * Answer the waiting event. `choiceId` null (or one no longer open)
     * takes the event's default — what the crew does when the captain
     * gives no order.
     */
    resolveVoyageEvent(player, world, choiceId) {
        const ship = this.getVoyageShip(player);
        const pending = ship && ship.voyage.pending;
        const def = pending ? this.getVoyageEvent(pending.id) : null;
        if (!def) {
            if (ship) ship.voyage.pending = null;
            return { success: false, message: 'Nothing is happening at sea.' };
        }
        const choices = def.choices || [];
        let choice = choiceId ? choices.find(c => c.id === choiceId) : null;
        if (choice && this._voyageReqReason(player, ship, choice.requires)) {
            return { success: false, message: this._voyageReqReason(player, ship, choice.requires) };
        }
        const auto = !choice;
        if (!choice) {
            choice = choices.find(c => c.id === def.default && !this._voyageReqReason(player, ship, c.requires))
                || choices.find(c => !this._voyageReqReason(player, ship, c.requires));
        }
        ship.voyage.pending = null;
        if (!choice) return { success: true, icon: def.icon, title: def.title, text: '', auto };
        const lines = [];
        this._applyVoyageOutcome(player, world, ship, choice, lines, 0);
        const text = (auto ? 'With no orders given, the crew decides: ' : '') + lines.join(' ');
        this._voyageLog(ship, def.icon || '❗', `${choice.label}. ${lines.join(' ')}`, world);
        return { success: true, icon: def.icon, title: def.title, choice: choice.id, text, auto };
    },

    /**
     * Apply one outcome block of a voyage event: its effects, then a chance
     * roll or a fight that leads to further blocks.
     */
    _applyVoyageOutcome(player, world, ship, fx, lines, depth) {
        if (!fx || depth > 4) return;
        if (fx.text) lines.push(fx.text);
        const v = ship.voyage;
        const q = typeof ship.q === 'number' ? ship.q : player.q;
        const r = typeof ship.r === 'number' ? ship.r : player.r;

        if (fx.morale) { this._ensureCrew(ship); this._setMorale(ship, ship.morale + fx.morale); }
        if (fx.crew) {
            this._ensureCrew(ship);
            if (fx.crew < 0) {
                const lost = Math.min(ship.crew, -fx.crew);
                ship.crew -= lost;
                if (lost) lines.push(`(${lost} hand${lost === 1 ? '' : 's'} lost)`);
            } else {
                const room = Math.max(0, this.getShipEffectiveStats(ship).crewRequired - ship.crew);
                ship.crew += Math.min(room, fx.crew);
            }
        }
        let gold = 0;
        if (fx.gold) gold += _roll(fx.gold);
        if (fx.goldPerCrew) gold += fx.goldPerCrew * this.getCrew(ship);
        if (gold) {
            if (gold < 0) gold = -Math.min(-gold, Math.max(0, player.gold || 0));
            player.gold = (player.gold || 0) + gold;
            if (player.financeToday && gold > 0) player.financeToday.income.exploration = (player.financeToday.income.exploration || 0) + gold;
            if (player.financeToday && gold < 0) player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) - gold;
            lines.push(gold > 0 ? `(+${gold}g)` : `(${gold}g)`);
        }
        if (fx.renown) player.renown = Math.max(0, (player.renown || 0) + fx.renown);
        if (fx.karma) player.karma = (player.karma || 0) + fx.karma;
        if (fx.hull) {
            const dmg = this.mitigateHullDamage(ship, fx.hull);
            ship.condition = Math.max(5, (ship.condition || 100) - dmg);
            lines.push(`(hull −${dmg}%)`);
        }
        if (fx.repair) ship.condition = Math.min(100, (ship.condition || 100) + fx.repair);
        if (fx.delay && v) v.delay = _num(v.delay) + fx.delay;
        if (fx.cargo) {
            if (!ship.cargo) ship.cargo = {};
            for (const [good, n] of Object.entries(fx.cargo)) {
                const add = Math.min(n, this.getCargoFree(ship));
                if (add > 0) ship.cargo[good] = (ship.cargo[good] || 0) + add;
            }
        }
        if (fx.loseCargo) {
            const foods = new Set(this._getProvisionSettings().foods);
            for (const [good, qty] of Object.entries(ship.cargo || {})) {
                if (foods.has(good)) continue;
                const lost = Math.floor(qty * fx.loseCargo);
                if (lost <= 0) continue;
                ship.cargo[good] -= lost;
                if (ship.cargo[good] <= 0) delete ship.cargo[good];
            }
        }
        if (fx.provisions > 0) this._stowProvisions(ship, fx.provisions);
        if (fx.provisions < 0) this._eatFromHold(ship, -fx.provisions);
        if (fx.heat && world) {
            const kingdomId = Underworld._nearestKingdom(world, q, r);
            if (kingdomId) Underworld.addHeat(player, kingdomId, fx.heat, world);
        }
        if (fx.deed) {
            for (const [deed, amount] of Object.entries(fx.deed)) Traits.recordDeed(player, deed, amount);
        }
        if (fx.piracy) {
            const data = (typeof DataLoader !== 'undefined' && DataLoader.ships) || {};
            player.karma = (player.karma || 0) - (data.piracyKarmaLoss || 5);
            player.renown = Math.max(0, (player.renown || 0) - (data.piracyRenownLoss || 2));
            const repLoss = Math.max(1, 3 - (this.getShipEffectiveStats(ship).effects.stealthBonus || 0));
            for (const kId of Object.keys(player.reputation || {})) {
                player.reputation[kId] = (player.reputation[kId] || 0) - repLoss;
            }
            Quests.track(player, 'piracy_committed');
            if (world) Underworld.recordPiracy(player, world, q, r);
        }
        if (fx.sickness && Ailments.startCrewOutbreak(player, ship, fx.sickness)) {
            const def = Ailments.def(fx.sickness);
            lines.push(`(${def ? def.name : fx.sickness} aboard)`);
        }

        if (fx.chance) {
            // A chance may lean on one of the player's attributes: { stat: 'luck', per: 0.06 }
            // shifts p by `per` for each point above (or below) 5
            let p = _num(fx.chance.p, 0.5);
            if (fx.chance.stat) p += (_num(player[fx.chance.stat], 5) - 5) * _num(fx.chance.per, 0.05);
            const pass = Utils.random() < Math.max(0.05, Math.min(0.95, p));
            this._applyVoyageOutcome(player, world, ship, pass ? fx.chance.pass : fx.chance.fail, lines, depth + 1);
        }
        if (fx.fight) {
            const f = fx.fight;
            const enemy = _roll(f.strength || [10, 20]);
            const own = this._getShipCombatStrength(ship, player);
            const won = own * Utils.randFloat(0.8, 1.2) > enemy * Utils.randFloat(0.8, 1.2);
            const toll = this._crewAfterBattle(ship, won);
            if (won) {
                Quests.track(player, 'battles_won');
                if (f.pirates) { Quests.track(player, 'raiders_defeated'); Quests.track(player, 'pirates_defeated'); }
                if (f.monster) Quests.track(player, 'special_creatures_defeated');
                Traits.recordDeed(player, 'seafaring', 1);
            }
            this._applyVoyageOutcome(player, world, ship, won ? f.win : f.lose, lines, depth + 1);
            if (!won) {
                const wound = Ailments.maybeWound(player, world, 'sea_battle');
                if (wound) lines.push(`${wound.icon} You took ${wound.name.toLowerCase()} in the fighting.`);
            }
            if (toll.text) lines.push(toll.text.trim());
        }
    },

    /* ── Save / load ─────────────────────────────────────────── */

    /** Backfill voyage and provision fields on a loaded ship. */
    _backfillVoyage(player, ship) {
        if (!Number.isFinite(ship.hungryDays)) ship.hungryDays = 0;
        if (!Number.isFinite(ship.rationCarry)) ship.rationCarry = 0;
        const v = ship.voyage;
        if (!v) return;
        if (player.boardedShip !== ship.id || !Array.isArray(v.route) || !v.route.length) {
            delete ship.voyage;
            if (ship.status === 'at_sea' && player.boardedShip !== ship.id) ship.status = 'anchored';
            return;
        }
        if (!Number.isFinite(v.step)) v.step = 0;
        if (!Number.isFinite(v.day)) v.day = 0;
        if (!Number.isFinite(v.delay)) v.delay = 0;
        if (!Number.isFinite(v.fromQ)) { v.fromQ = ship.q; v.fromR = ship.r; }
        if (!Array.isArray(v.log)) v.log = [];
        if (v.pending === undefined) v.pending = null;
    },
};
