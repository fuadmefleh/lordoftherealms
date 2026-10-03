
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { Quests } from './quests.js';
import { Technology } from './technology.js';

/**
 * Ships System
 * Allows the player to buy, build, customize, move, and use ships.
 * Supports exploration, piracy, pirate hunting, and sea trade.
 */
export const Ships = {

    _nextId: 1,

    /* ── Data accessors ─────────────────────────────────────── */

    _getShipTypes() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.shipTypes)
            ? DataLoader.ships.shipTypes : [];
    },

    _getCustomizations() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.customizations)
            ? DataLoader.ships.customizations : [];
    },

    _getExplorationEvents() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.explorationEvents)
            ? DataLoader.ships.explorationEvents : [];
    },

    _getTradeGoods() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.tradeGoods)
            ? DataLoader.ships.tradeGoods : [];
    },

    _getSettings() {
        return (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.settings)
            ? DataLoader.ships.settings : {
                usedShipConditionRange: [40, 85],
                usedShipPriceMultiplier: [0.4, 0.75],
                maxUsedShipsPerSettlement: 3,
                buildCostMultiplier: { village: 1.2, town: 1.0, capital: 0.9 },
                repairCostPerPercent: 0.005,
                conditionDecayChance: 0.04,
                shipMovementPerDay: 3,
                npcShipBuyChance: 0.02
            };
    },

    /* ── Type / customization lookups ────────────────────────── */

    getShipType(id) {
        return this._getShipTypes().find(s => s.id === id) || null;
    },

    getCustomization(id) {
        return this._getCustomizations().find(c => c.id === id) || null;
    },

    getAvailableCustomizations(shipTypeId) {
        const st = this.getShipType(shipTypeId);
        if (!st || !st.customizations) return [];
        return st.customizations.map(cid => this.getCustomization(cid)).filter(Boolean);
    },

    _getCustomizationEffectTotals(ship) {
        const totals = {
            speedBonus: 0,
            cargoBonus: 0,
            combatBonus: 0,
            armorBonus: 0,
            crewBonus: 0,
            stealthBonus: 0,
            explorationBonus: 0,
            captureBonus: 0,
            fishingBonus: 0,
            renownBonus: 0,
            charismaBonus: 0,
        };

        for (const cid of (ship && ship.customizations) || []) {
            const c = this.getCustomization(cid);
            if (!c || !c.effects) continue;
            for (const [key, value] of Object.entries(c.effects)) {
                if (!Number.isFinite(value)) continue;
                if (totals[key] === undefined) totals[key] = 0;
                totals[key] += value;
            }
        }

        return totals;
    },

    getShipEffectiveStats(ship) {
        const st = this.getShipType(ship.typeId);
        const fx = this._getCustomizationEffectTotals(ship);

        return {
            speed: Math.max(1, (st ? st.speed : 3) + (fx.speedBonus || 0)),
            cargoCapacity: Math.max(0, (st ? st.cargoCapacity : 10) + (fx.cargoBonus || 0)),
            combatStrength: Math.max(1, (st ? st.combatStrength : 5) + (fx.combatBonus || 0)),
            armor: Math.max(0, (st ? st.armor : 0) + (fx.armorBonus || 0)),
            crewRequired: Math.max(1, (st ? st.crewRequired : 1) + (fx.crewBonus || 0)),
            effects: fx,
        };
    },

    getUpgradeableCustomizations(ship) {
        const st = this.getShipType(ship && ship.typeId);
        if (!st || !Array.isArray(st.customizations)) return [];
        const installed = new Set((ship && ship.customizations) || []);
        return st.customizations
            .filter(cid => !installed.has(cid))
            .map(cid => this.getCustomization(cid))
            .filter(Boolean);
    },

    getShipUpgradeQuote(ship, customizationIds) {
        const wantIds = Array.isArray(customizationIds) ? customizationIds : [customizationIds];
        const available = new Map(this.getUpgradeableCustomizations(ship).map(c => [c.id, c]));
        const picked = [];
        let totalCost = 0;

        for (const cid of wantIds) {
            const c = available.get(cid);
            if (!c) continue;
            picked.push(c);
            totalCost += c.cost || 0;
            available.delete(cid);
        }

        return { totalCost, picked };
    },

    /* ── Player ship queries ─────────────────────────────────── */

    getShipById(player, shipId) {
        return (player.ships || []).find(s => s.id === shipId) || null;
    },

    /** Ships docked at a specific location */
    getShipsAt(player, q, r) {
        return (player.ships || []).filter(s => s.q === q && s.r === r && s.status === 'docked');
    },

    /** All player ships regardless of status */
    getAllShips(player) {
        return player.ships || [];
    },

    /* ── Used ships for sale ─────────────────────────────────── */

    getUsedShipsForSale(tile) {
        if (!tile || !tile.settlement) return [];
        if (tile._usedShips) return tile._usedShips;

        const settings = this._getSettings();
        const types = this._getShipTypes().filter(st => st.availableIn.includes(tile.settlement.type));
        const names = (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.usedShipNames) || ['Old Ship'];
        const descs = (typeof DataLoader !== 'undefined' && DataLoader.ships && DataLoader.ships.usedShipDescriptions) || ['A used ship'];
        const maxUsed = settings.maxUsedShipsPerSettlement || 3;
        const ships = [];

        for (let i = 0; i < maxUsed; i++) {
            if (Utils.random() > 0.5) continue; // ~50% chance per slot
            const st = types[Math.floor(Utils.random() * types.length)];
            if (!st) continue;

            const condRange = settings.usedShipConditionRange || [40, 85];
            const condition = condRange[0] + Math.floor(Utils.random() * (condRange[1] - condRange[0]));
            const priceRange = settings.usedShipPriceMultiplier || [0.4, 0.75];
            const priceMult = priceRange[0] + Utils.random() * (priceRange[1] - priceRange[0]);
            const price = Math.floor(st.baseCost * priceMult * (condition / 100));

            ships.push({
                typeId: st.id,
                name: names[Math.floor(Utils.random() * names.length)],
                description: descs[Math.floor(Utils.random() * descs.length)],
                condition,
                price,
            });
        }

        tile._usedShips = ships;
        return ships;
    },

    /* ── Buying a used ship ──────────────────────────────────── */

    buyUsedShip(player, world, q, r, usedIndex) {
        const tile = world ? world.getTile(q, r) : null;
        const usedShips = tile ? this.getUsedShipsForSale(tile) : [];
        if (usedIndex < 0 || usedIndex >= usedShips.length) {
            return { success: false, message: 'Ship no longer available.' };
        }

        const used = usedShips[usedIndex];
        if (player.gold < used.price) {
            return { success: false, message: `Not enough gold. Need ${used.price}g.` };
        }

        player.gold -= used.price;
        if (!player.ships) player.ships = [];

        const ship = {
            id: 'ship_' + (Ships._nextId++),
            typeId: used.typeId,
            name: used.name,
            q, r,
            status: 'docked',
            condition: used.condition,
            customizations: [],
            cargo: {},
            dockedAt: tile && tile.settlement ? tile.settlement.name : 'Unknown',
            purchaseDay: world ? world.day : 0,
        };
        player.ships.push(ship);

        // Remove from used market
        usedShips.splice(usedIndex, 1);

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + used.price;
        }

        const st = this.getShipType(used.typeId);
        return { success: true, message: `Purchased ${used.name} (${st ? st.name : 'ship'}) for ${used.price}g!` };
    },

    /* ── Commissioning a new ship ────────────────────────────── */

    commissionShip(player, q, r, typeId, name, customizationIds, world) {
        const st = this.getShipType(typeId);
        if (!st) return { success: false, message: 'Unknown ship type.' };

        const tile = world.getTile(q, r);
        if (!tile || !tile.settlement) return { success: false, message: 'Must be at a settlement.' };

        const baseCost = this._getSettlementBuildCost(st.baseCost, tile.settlement);
        let totalCost = baseCost;

        // Add customization costs
        const validCustoms = [];
        for (const cid of (customizationIds || [])) {
            const c = this.getCustomization(cid);
            if (c && st.customizations && st.customizations.includes(cid)) {
                totalCost += c.cost;
                validCustoms.push(cid);
            }
        }

        if (player.gold < totalCost) {
            return { success: false, message: `Not enough gold. Need ${totalCost}g.` };
        }

        player.gold -= totalCost;
        if (!player.ships) player.ships = [];

        const ship = {
            id: 'ship_' + (Ships._nextId++),
            typeId,
            name: name || this._generateShipName(),
            q, r,
            status: 'building',
            condition: 100,
            customizations: validCustoms,
            cargo: {},
            dockedAt: tile.settlement.name,
            buildDaysLeft: st.buildDays,
            purchaseDay: world.day || 0,
        };
        player.ships.push(ship);

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + totalCost;
        }

        return {
            success: true,
            message: `Commissioned ${st.icon} ${ship.name} for ${totalCost}g. Ready in ${st.buildDays} days.`
        };
    },

    /* ── Selling a ship ──────────────────────────────────────── */

    sellShip(player, shipId) {
        const idx = (player.ships || []).findIndex(s => s.id === shipId);
        if (idx === -1) return { success: false, message: 'Ship not found.' };

        const ship = player.ships[idx];
        if (ship.status !== 'docked') {
            return { success: false, message: 'Ship must be docked to sell.' };
        }

        const value = this.getShipValue(ship);
        const salePrice = Math.floor(value * 0.5);

        player.gold += salePrice;
        player.ships.splice(idx, 1);

        if (player.financeToday) {
            player.financeToday.income.shipSale = (player.financeToday.income.shipSale || 0) + salePrice;
        }

        return { success: true, message: `Sold ${ship.name} for ${salePrice}g.`, salePrice };
    },

    /* ── Ship value ──────────────────────────────────────────── */

    getShipValue(ship) {
        const st = this.getShipType(ship.typeId);
        const base = st ? st.baseCost : 200;
        const customValue = (ship.customizations || []).reduce((sum, cid) => {
            const c = this.getCustomization(cid);
            return sum + (c ? c.cost : 0);
        }, 0);
        return Math.floor((base + customValue) * (ship.condition / 100));
    },

    /* ── Ship repair ─────────────────────────────────────────── */

    getRepairCost(ship) {
        const st = this.getShipType(ship.typeId);
        const baseCost = st ? st.baseCost : 200;
        const settings = this._getSettings();
        const costPerPercent = settings.repairCostPerPercent || 0.005;
        const damage = 100 - ship.condition;
        return Math.max(5, Math.floor(baseCost * costPerPercent * damage));
    },

    repairShip(player, shipId) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.condition >= 100) return { success: false, message: 'Ship is in perfect condition.' };
        if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked.' };

        const cost = this.getRepairCost(ship);
        if (player.gold < cost) return { success: false, message: `Need ${cost}g for repairs.` };

        player.gold -= cost;
        ship.condition = 100;

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + cost;
        }

        return { success: true, message: `Repaired ${ship.name} for ${cost}g.` };
    },

    upgradeShip(player, shipId, customizationIds) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked for upgrades.' };

        const ids = Array.isArray(customizationIds) ? customizationIds : [customizationIds];
        if (!ids.length) return { success: false, message: 'No upgrades selected.' };

        const quote = this.getShipUpgradeQuote(ship, ids);
        if (!quote.picked.length) return { success: false, message: 'No valid upgrades available.' };

        if (player.gold < quote.totalCost) {
            return { success: false, message: `Not enough gold. Need ${quote.totalCost}g.` };
        }

        player.gold -= quote.totalCost;
        if (!Array.isArray(ship.customizations)) ship.customizations = [];
        for (const c of quote.picked) ship.customizations.push(c.id);

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + quote.totalCost;
        }

        const names = quote.picked.map(c => c.name).join(', ');
        return {
            success: true,
            message: `Upgraded ${ship.name} with ${names} for ${quote.totalCost}g.`,
            totalCost: quote.totalCost,
            upgrades: quote.picked,
        };
    },

    /* ── Moving ships between ports ──────────────────────────── */

    moveShip(player, shipId, destQ, destR, destName, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked to move.' };

        const stats = this.getShipEffectiveStats(ship);
        const dist = Hex.distance(ship.q, ship.r, destQ, destR);
        const speed = stats.speed;
        const travelDays = Math.max(1, Math.ceil(dist / speed));

        ship.status = 'moving';
        ship.destQ = destQ;
        ship.destR = destR;
        ship.destinationName = destName;
        ship.travelDaysLeft = travelDays;

        return { success: true, message: `${ship.name} is sailing to ${destName}. ETA: ${travelDays} days.` };
    },

    /* ── Player sails on their ship ──────────────────────────── */

    sailPlayerTo(player, shipId, destQ, destR, destName, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked.' };

        const st = this.getShipType(ship.typeId);
        const stats = this.getShipEffectiveStats(ship);
        const dist = Hex.distance(ship.q, ship.r, destQ, destR);
        const speed = stats.speed;
        const travelDays = Math.max(1, Math.ceil(dist / speed));
        const travelCost = travelDays * (st ? st.dailyUpkeep : 5);

        if (player.gold < travelCost) {
            return { success: false, message: `Need ${travelCost}g for the journey.` };
        }

        player.gold -= travelCost;

        // Teleport player and ship
        player.q = destQ;
        player.r = destR;
        ship.q = destQ;
        ship.r = destR;
        ship.dockedAt = destName;

        // Condition degrades slightly from travel
        ship.condition = Math.max(10, ship.condition - Math.floor(travelDays * 0.5));

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + travelCost;
        }

        return { success: true, message: `Sailed to ${destName} in ${travelDays} days for ${travelCost}g.` };
    },

    /* ── Landing ashore / ports ──────────────────────────────── */

    /** Terrain ids a ship can float on (beach is land you can wade onto). */
    WATER_TERRAINS: ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'],

    /** Cargo units a ship's boat can ferry per day where there is no port. */
    LANDING_BOAT_CAPACITY: 5,

    isWaterTile(tile) {
        return !!(tile && tile.terrain && this.WATER_TERRAINS.includes(tile.terrain.id));
    },

    /** A port is a settlement on the water — the only place cargo unloads freely. */
    isPortTile(world, q, r) {
        const tile = world.getTile(q, r);
        if (!tile || !tile.settlement) return false;
        return Hex.neighbors(q, r).some(n => this.isWaterTile(world.getTile(n.q, n.r)));
    },

    /** Walkable land hexes next to (q, r) that the ship's boat can row to. */
    getRowAshoreTargets(world, q, r) {
        return Hex.neighbors(q, r)
            .map(n => world.getTile(n.q, n.r))
            .filter(t => t && t.terrain && t.terrain.passable && !this.isWaterTile(t));
    },

    /** Ships anchored offshore on, or next to, hex (q, r). */
    getAnchoredShipsNear(player, q, r) {
        return (player.ships || []).filter(s => s.status === 'anchored' && Hex.distance(s.q, s.r, q, r) <= 1);
    },

    /** Total units currently in the ship's hold. */
    getCargoUsed(ship) {
        return Object.values(ship.cargo || {}).reduce((s, n) => s + n, 0);
    },

    /** Free space left in the ship's hold. */
    getCargoFree(ship) {
        return Math.max(0, this.getShipEffectiveStats(ship).cargoCapacity - this.getCargoUsed(ship));
    },

    /**
     * Units the ship's boat can still ferry today between the hold and
     * shore at (q, r). Unlimited at a port; elsewhere the boat moves
     * LANDING_BOAT_CAPACITY units per ship per day, in either direction.
     */
    getFerryAllowance(ship, world, q, r) {
        if (this.isPortTile(world, q, r)) return Infinity;
        const used = ship.ferryDay === (world.day || 0) ? (ship.ferryUnits || 0) : 0;
        return Math.max(0, this.LANDING_BOAT_CAPACITY - used);
    },

    /** Record boat trips against today's ferry allowance. */
    _useFerry(ship, world, units) {
        const day = world.day || 0;
        if (ship.ferryDay !== day) {
            ship.ferryDay = day;
            ship.ferryUnits = 0;
        }
        ship.ferryUnits += units;
    },

    /**
     * Ships whose hold the player can reach from where they stand: docked on
     * the player's hex, or anchored next to it while the player is ashore.
     * Never while aboard — goods only cross between hold and shore by dock
     * or boat, which is what keeps the boat-load limit meaningful.
     */
    getShipsWithHoldAccess(player) {
        if (player.boardedShip) return [];
        return (player.ships || []).filter(s =>
            (s.status === 'docked' && s.q === player.q && s.r === player.r) ||
            (s.status === 'anchored' && Hex.distance(s.q, s.r, player.q, player.r) <= 1));
    },

    /**
     * Load `qty` of an inventory item into a ship the player has hold access
     * to, limited by free hold space and (off-port) the day's boat allowance.
     */
    loadCargo(player, world, shipId, itemId, qty) {
        const ship = this.getShipsWithHoldAccess(player).find(s => s.id === shipId);
        if (!ship) return { success: false, message: "You cannot reach that ship's hold from here." };
        const have = (player.inventory && player.inventory[itemId]) || 0;
        const allowance = this.getFerryAllowance(ship, world, player.q, player.r);
        const n = Math.min(qty, have, this.getCargoFree(ship), allowance);
        if (n <= 0) {
            const why = have <= 0 ? 'You have none of that.'
                : this.getCargoFree(ship) <= 0 ? 'The hold is full.'
                    : 'The boat has made all its trips today — a port has no such limit.';
            return { success: false, message: why };
        }
        player.inventory[itemId] = have - n;
        if (player.inventory[itemId] <= 0) delete player.inventory[itemId];
        if (!ship.cargo) ship.cargo = {};
        ship.cargo[itemId] = (ship.cargo[itemId] || 0) + n;
        if (allowance !== Infinity) this._useFerry(ship, world, n);
        return { success: true, ship, loaded: n };
    },

    /**
     * Unload cargo from a ship the player has hold access to into their
     * inventory — `itemId` alone, or the whole hold when omitted — limited
     * off-port by the day's boat allowance.
     */
    unloadToPlayer(player, world, shipId, itemId = null, qty = Infinity) {
        const ship = this.getShipsWithHoldAccess(player).find(s => s.id === shipId);
        if (!ship) return { success: false, message: "You cannot reach that ship's hold from here." };
        const allowance = this.getFerryAllowance(ship, world, player.q, player.r);
        if (allowance <= 0) {
            return { success: false, message: 'The boat has made all its trips today — a port has no such limit.' };
        }
        const cargo = this.unloadCargo(ship, player, Math.min(qty, allowance), itemId);
        if (allowance !== Infinity) this._useFerry(ship, world, cargo.total);
        return { success: true, ship, cargo };
    },

    /**
     * Move up to maxUnits of cargo (optionally one item only) from the ship's
     * hold into the player's inventory. Returns what moved and how much is
     * left aboard.
     */
    unloadCargo(ship, player, maxUnits = Infinity, itemId = null) {
        const moved = {};
        let budget = maxUnits;
        let total = 0;
        if (!player.inventory) player.inventory = {};
        for (const [item, qty] of Object.entries(ship.cargo || {})) {
            if (budget <= 0) break;
            if (itemId && item !== itemId) continue;
            const take = Math.min(qty, budget);
            if (take <= 0) continue;
            ship.cargo[item] = qty - take;
            if (ship.cargo[item] <= 0) delete ship.cargo[item];
            player.inventory[item] = (player.inventory[item] || 0) + take;
            moved[item] = take;
            budget -= take;
            total += take;
        }
        return { moved, total, remaining: this.getCargoUsed(ship) };
    },

    /**
     * Leave the boarded ship where the player is standing (a beach or a
     * port). Ports unload the whole hold; anywhere else only a boat-load.
     */
    disembark(player, world) {
        const ship = this.getShipById(player, player.boardedShip);
        if (!ship) return { success: false, message: 'Ship not found.' };
        const tile = world.getTile(player.q, player.r);
        if (!tile || !tile.terrain.passable) {
            return { success: false, message: 'You must be on land or a beach to disembark.' };
        }
        const isPort = this.isPortTile(world, player.q, player.r);
        player.boardedShip = null;
        ship.status = 'docked';
        ship.q = player.q;
        ship.r = player.r;
        ship.dockedAt = isPort && tile.settlement ? tile.settlement.name : null;
        const cargo = this._landCargo(ship, player, world, player.q, player.r);
        return { success: true, ship, isPort, cargo };
    },

    /**
     * Row the ship's boat from the boarded ship onto an adjacent land hex.
     * The ship drops anchor where it is and waits offshore; without a port
     * only a boat-load of cargo comes ashore.
     */
    rowAshore(player, world, destQ, destR) {
        const ship = this.getShipById(player, player.boardedShip);
        if (!ship) return { success: false, message: 'You are not aboard a ship.' };
        const dest = world.getTile(destQ, destR);
        const isTarget = !!dest && this.getRowAshoreTargets(world, player.q, player.r)
            .some(t => t.q === dest.q && t.r === dest.r);
        if (!isTarget) return { success: false, message: 'You can only row to walkable land next to your ship.' };

        ship.status = 'anchored';
        ship.q = player.q;
        ship.r = player.r;
        ship.dockedAt = null;
        player.boardedShip = null;
        player.q = dest.q;
        player.r = dest.r;
        player.path = null;

        const isPort = this.isPortTile(world, dest.q, dest.r);
        const cargo = this._landCargo(ship, player, world, dest.q, dest.r);
        return { success: true, ship, isPort, cargo };
    },

    /** Bring cargo ashore on landing, within the day's boat allowance. */
    _landCargo(ship, player, world, q, r) {
        const allowance = this.getFerryAllowance(ship, world, q, r);
        const cargo = this.unloadCargo(ship, player, allowance);
        if (allowance !== Infinity) this._useFerry(ship, world, cargo.total);
        return cargo;
    },

    /** Row back out to an anchored ship next to the player and board it. */
    rowToShip(player, shipId) {
        const ship = this.getShipById(player, shipId);
        if (!ship || ship.status !== 'anchored') return { success: false, message: 'No anchored ship there.' };
        if (Hex.distance(ship.q, ship.r, player.q, player.r) > 1) {
            return { success: false, message: 'Your ship is too far offshore.' };
        }
        player.q = ship.q;
        player.r = ship.r;
        player.path = null;
        player.boardedShip = ship.id;
        ship.status = 'at_sea';
        return { success: true, ship };
    },

    /* ── Sea activities ──────────────────────────────────────── */

    exploreOcean(player, shipId, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };

        const st = this.getShipType(ship.typeId);
        const events = this._getExplorationEvents();
        if (events.length === 0) {
            return { success: true, icon: '🌊', title: 'Calm seas. Nothing of note found.', type: 'info' };
        }

        // Pick event by weighted chance
        const roll = Utils.random();
        let cumulative = 0;
        let event = null;
        for (const e of events) {
            cumulative += e.chance;
            if (roll < cumulative) { event = e; break; }
        }
        if (!event) {
            // Default calm event
            return { success: true, icon: '🌊', title: 'You sail the open waters but find nothing interesting.', type: 'info' };
        }

        let resultText = event.description;
        let resultType = 'info';

        // Handle danger events
        if (event.danger) {
            if (event.danger.combatStrength) {
                const enemyStr = Array.isArray(event.danger.combatStrength)
                    ? event.danger.combatStrength[0] + Math.floor(Utils.random() * (event.danger.combatStrength[1] - event.danger.combatStrength[0]))
                    : event.danger.combatStrength;
                const shipStr = this._getShipCombatStrength(ship);

                if (shipStr * (0.8 + Utils.random() * 0.4) > enemyStr * (0.8 + Utils.random() * 0.4)) {
                    resultText += ' You fought and won!';
                    resultType = 'success';
                    Quests.track(player, 'battles_won');
                    if (event.id === 'sea_monster') Quests.track(player, 'special_creatures_defeated');
                    if (event.id === 'pirate_ambush') {
                        Quests.track(player, 'raiders_defeated');
                        Quests.track(player, 'pirates_defeated');
                    }
                    // Give rewards
                    if (event.reward) this._applyReward(player, event.reward);
                } else {
                    resultText += ' You were overwhelmed!';
                    resultType = 'error';
                    const dmg = event.danger.damage
                        ? (Array.isArray(event.danger.damage)
                            ? event.danger.damage[0] + Math.floor(Utils.random() * (event.danger.damage[1] - event.danger.damage[0]))
                            : event.danger.damage)
                        : 10;
                    ship.condition = Math.max(5, ship.condition - dmg);
                    player.health = Math.max(1, player.health - Math.floor(dmg / 2));
                }
            } else if (event.danger.damage) {
                const dmg = Array.isArray(event.danger.damage)
                    ? event.danger.damage[0] + Math.floor(Utils.random() * (event.danger.damage[1] - event.danger.damage[0]))
                    : event.danger.damage;
                ship.condition = Math.max(5, ship.condition - dmg);
                resultType = 'warning';
                resultText += ` Ship took ${dmg}% damage.`;
            }
        } else if (event.reward) {
            this._applyReward(player, event.reward);
            resultType = 'success';
        }

        // Slight condition wear from exploration
        ship.condition = Math.max(5, ship.condition - 1);

        return { success: true, icon: event.icon, title: resultText, type: resultType };
    },

    huntPirates(player, shipId, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };

        const data = (typeof DataLoader !== 'undefined' && DataLoader.ships) ? DataLoader.ships : {};
        const pirateStr = data.pirateStrength || { min: 8, max: 30 };
        const enemyStrength = pirateStr.min + Math.floor(Utils.random() * (pirateStr.max - pirateStr.min));
        const shipStr = this._getShipCombatStrength(ship);

        // 50% chance to find pirates
        if (Utils.random() < 0.5) {
            ship.condition = Math.max(5, ship.condition - 1);
            return {
                success: true,
                icon: '🌊',
                title: 'You patrol the waters but find no pirates today.',
                type: 'info'
            };
        }

        const playerPower = shipStr * (0.8 + Utils.random() * 0.4);
        const enemyPower = enemyStrength * (0.8 + Utils.random() * 0.4);

        if (playerPower > enemyPower) {
            Quests.track(player, 'battles_won');
            Quests.track(player, 'raiders_defeated');
            Quests.track(player, 'pirates_defeated');
            const loot = enemyStrength * (2 + Math.floor(Utils.random() * 4));
            player.gold += loot;
            player.karma = (player.karma || 0) + 2;
            player.renown = (player.renown || 0) + 3;
            ship.condition = Math.max(5, ship.condition - Math.floor(Utils.random() * 5 + 2));

            if (player.financeToday) {
                player.financeToday.income.pirateBounty = (player.financeToday.income.pirateBounty || 0) + loot;
            }

            return {
                success: true,
                icon: '⚔️',
                title: `Victory! Defeated pirates (str ${enemyStrength}) and claimed ${loot}g bounty! +3 renown, +2 karma.`,
                type: 'success'
            };
        } else {
            const dmg = 5 + Math.floor(Utils.random() * 15);
            ship.condition = Math.max(5, ship.condition - dmg);
            player.health = Math.max(1, player.health - Math.floor(dmg / 2));
            return {
                success: true,
                icon: '💀',
                title: `Defeated! The pirates were too strong (str ${enemyStrength}). Ship took ${dmg}% damage.`,
                type: 'error'
            };
        }
    },

    commitPiracy(player, shipId, world) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };

        const data = (typeof DataLoader !== 'undefined' && DataLoader.ships) ? DataLoader.ships : {};
        const karmaLoss = data.piracyKarmaLoss || 5;
        const renownLoss = data.piracyRenownLoss || 2;
        const goldRange = data.piracyGoldRange || [50, 300];

        // 60% chance to find a target
        if (Utils.random() < 0.4) {
            ship.condition = Math.max(5, ship.condition - 1);
            return {
                success: true,
                icon: '🌊',
                title: 'You lurk the shipping lanes but no prey appears.',
                type: 'info'
            };
        }

        // Target merchant ship strength
        const targetStr = 3 + Math.floor(Utils.random() * 12);
        const shipStr = this._getShipCombatStrength(ship);
        const playerPower = shipStr * (0.8 + Utils.random() * 0.4);
        const targetPower = targetStr * (0.8 + Utils.random() * 0.4);

        if (playerPower > targetPower) {
            const loot = goldRange[0] + Math.floor(Utils.random() * (goldRange[1] - goldRange[0]));
            player.gold += loot;
            player.karma = (player.karma || 0) - karmaLoss;
            player.renown = Math.max(0, (player.renown || 0) - renownLoss);
            ship.condition = Math.max(5, ship.condition - Math.floor(Utils.random() * 3 + 1));

            // Reputation loss with all kingdoms
            for (const kId of Object.keys(player.reputation || {})) {
                player.reputation[kId] = (player.reputation[kId] || 0) - 3;
            }

            if (player.financeToday) {
                player.financeToday.income.piracy = (player.financeToday.income.piracy || 0) + loot;
            }

            return {
                success: true,
                icon: '🏴‍☠️',
                title: `Plundered a merchant vessel for ${loot}g! -${karmaLoss} karma, -${renownLoss} renown. Your reputation suffers.`,
                type: 'warning'
            };
        } else {
            const dmg = 5 + Math.floor(Utils.random() * 10);
            ship.condition = Math.max(5, ship.condition - dmg);
            player.karma = (player.karma || 0) - Math.floor(karmaLoss / 2);
            return {
                success: true,
                icon: '💀',
                title: `The merchant fought back hard! Failed to board. Ship took ${dmg}% damage.`,
                type: 'error'
            };
        }
    },

    /* ── Port markets ────────────────────────────────────────── */

    /** Days a port's prices hold before they drift. */
    PORT_PRICE_PERIOD: 7,

    /**
     * Deterministic 32-bit hash of integers — port prices must be stable for
     * a given port/good/week without drawing from the game RNG.
     */
    _hash(...nums) {
        let h = 2166136261;
        for (const n of nums) {
            h ^= (n | 0);
            h = Math.imul(h, 16777619);
            h ^= h >>> 13;
        }
        return h >>> 0;
    },

    /**
     * What a port trades in. Each port is an exporter (cheap to buy, pays
     * little), importer (pays well, sells none) or local market for each
     * good; roles are fixed per port, prices drift every PORT_PRICE_PERIOD
     * days. Buy low at an exporter, sail, sell high at an importer.
     * @returns {Array<{id, name, icon, role, buy: number|null, sell: number}>}
     */
    getPortMarket(world, q, r) {
        const period = Math.floor((world.day || 0) / this.PORT_PRICE_PERIOD);
        const lerp = ([lo, hi], t) => Math.round(lo + (hi - lo) * t);
        return this._getTradeGoods().filter(g => g.id).map((g, i) => {
            const roleRoll = this._hash(q, r, i) % 3;
            const t = (this._hash(q, r, i, period) % 1000) / 1000;
            const base = { id: g.id, name: g.name, icon: g.icon || '📦' };
            if (roleRoll === 0) {
                const buy = Math.max(2, lerp(g.buyPrice, t));
                return { ...base, role: 'export', buy, sell: Math.max(1, Math.min(buy - 1, Math.round(buy * 0.75))) };
            }
            if (roleRoll === 1) {
                return { ...base, role: 'import', buy: null, sell: lerp(g.sellPrice, t) };
            }
            // Local market: priced between the two ranges, with a spread
            // (a port always charges more than it pays, so there's no same-port loop)
            const mid = lerp([g.buyPrice[1], g.sellPrice[0]], t);
            const buy = Math.max(2, Math.ceil(mid * 1.1));
            return { ...base, role: 'local', buy, sell: Math.max(1, Math.min(buy - 1, Math.floor(mid * 0.9))) };
        });
    },

    /** The player's ship docked at a port on the player's hex, if any. */
    _getShipAtPort(player, world, shipId) {
        if (!this.isPortTile(world, player.q, player.r)) return null;
        return this.getShipsWithHoldAccess(player)
            .find(s => s.id === shipId && s.status === 'docked') || null;
    },

    /** Buy a trade good at this port straight into a docked ship's hold. */
    buyTradeGood(player, world, shipId, goodId, qty) {
        const ship = this._getShipAtPort(player, world, shipId);
        if (!ship) return { success: false, message: 'Your ship must be docked at this port.' };
        const entry = this.getPortMarket(world, player.q, player.r).find(e => e.id === goodId);
        if (!entry || entry.buy === null) return { success: false, message: 'This port does not sell that.' };
        const n = Math.min(qty, this.getCargoFree(ship), Math.floor((player.gold || 0) / entry.buy));
        if (n <= 0) {
            return { success: false, message: this.getCargoFree(ship) <= 0 ? 'The hold is full.' : 'You cannot afford any.' };
        }
        const cost = n * entry.buy;
        player.gold -= cost;
        if (!ship.cargo) ship.cargo = {};
        ship.cargo[goodId] = (ship.cargo[goodId] || 0) + n;
        if (player.financeToday) {
            player.financeToday.expenses.seaTrade = (player.financeToday.expenses.seaTrade || 0) + cost;
        }
        return { success: true, ship, bought: n, cost };
    },

    /** Sell a trade good from a docked ship's hold to this port. */
    sellTradeGood(player, world, shipId, goodId, qty) {
        const ship = this._getShipAtPort(player, world, shipId);
        if (!ship) return { success: false, message: 'Your ship must be docked at this port.' };
        const entry = this.getPortMarket(world, player.q, player.r).find(e => e.id === goodId);
        if (!entry) return { success: false, message: 'Nobody here buys that.' };
        const n = Math.min(qty, (ship.cargo && ship.cargo[goodId]) || 0);
        if (n <= 0) return { success: false, message: 'None of that in the hold.' };
        const revenue = Math.floor(n * entry.sell * (1 + Technology.getTradeProfitBonus(player)));
        ship.cargo[goodId] -= n;
        if (ship.cargo[goodId] <= 0) delete ship.cargo[goodId];
        player.gold = (player.gold || 0) + revenue;
        Quests.track(player, 'trade_profit', revenue);
        if (player.skills && Utils.random() < 0.2) {
            player.skills.commerce = Math.min(10, (player.skills.commerce || 1) + 0.1);
        }
        if (player.financeToday) {
            player.financeToday.income.seaTrade = (player.financeToday.income.seaTrade || 0) + revenue;
        }
        return { success: true, ship, sold: n, revenue };
    },

    /* ── Daily processing ────────────────────────────────────── */

    processDaily(player, world) {
        const ships = player.ships || [];
        if (ships.length === 0) return;

        const settings = this._getSettings();
        let totalUpkeep = 0;

        for (const ship of ships) {
            const st = this.getShipType(ship.typeId);
            if (!st) continue;

            // Building progress
            if (ship.status === 'building') {
                ship.buildDaysLeft = (ship.buildDaysLeft || 1) - 1;
                if (ship.buildDaysLeft <= 0) {
                    ship.status = 'docked';
                    ship.buildDaysLeft = 0;
                    // Notification handled by caller if needed
                }
            }

            // Ship movement
            if (ship.status === 'moving') {
                ship.travelDaysLeft = (ship.travelDaysLeft || 1) - 1;
                if (ship.travelDaysLeft <= 0) {
                    ship.q = ship.destQ;
                    ship.r = ship.destR;
                    ship.dockedAt = ship.destinationName || 'Unknown';
                    ship.status = 'docked';
                    ship.travelDaysLeft = 0;
                    delete ship.destQ;
                    delete ship.destR;
                    delete ship.destinationName;
                }
            }

            // Daily upkeep
            totalUpkeep += st.dailyUpkeep;

            // Condition decay
            if (Utils.random() < (settings.conditionDecayChance || 0.04)) {
                ship.condition = Math.max(10, ship.condition - 1);
            }
        }

        // Deduct total upkeep
        if (totalUpkeep > 0) {
            player.gold -= totalUpkeep;
            if (player.financeToday) {
                player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + totalUpkeep;
            }
        }
    },

    /* ── Combat helpers ──────────────────────────────────────── */

    _getShipCombatStrength(ship) {
        const stats = this.getShipEffectiveStats(ship);
        let strength = stats.combatStrength;

        // Condition penalty
        strength = Math.floor(strength * (ship.condition / 100));
        return Math.max(1, strength);
    },

    /* ── Reward helper ───────────────────────────────────────── */

    _applyReward(player, reward) {
        if (reward.gold) {
            const amt = Array.isArray(reward.gold)
                ? reward.gold[0] + Math.floor(Utils.random() * (reward.gold[1] - reward.gold[0]))
                : reward.gold;
            player.gold += amt;
            if (player.financeToday) {
                player.financeToday.income.exploration = (player.financeToday.income.exploration || 0) + amt;
            }
        }
        if (reward.renown) player.renown = (player.renown || 0) + reward.renown;
        if (reward.karma) player.karma = (player.karma || 0) + reward.karma;
        if (reward.stamina) player.stamina = Math.min(player.maxStamina || 10, (player.stamina || 0) + reward.stamina);
        if (reward.luck) player.luck = (player.luck || 5) + reward.luck;
    },

    /* ── Name generation ─────────────────────────────────────── */

    _generateShipName() {
        const data = (typeof DataLoader !== 'undefined' && DataLoader.ships) ? DataLoader.ships : {};
        const prefixes = data.shipNamePrefixes || ['The', 'HMS'];
        const words = data.shipNameWords || ['Tempest', 'Horizon', 'Phoenix'];
        const prefix = prefixes[Math.floor(Utils.random() * prefixes.length)];
        const word = words[Math.floor(Utils.random() * words.length)];
        return `${prefix} ${word}`;
    },

    /* ── Price helpers ───────────────────────────────────────── */

    _getSettlementBuildCost(baseCost, settlement) {
        const settings = this._getSettings();
        const mults = settings.buildCostMultiplier || { village: 1.2, town: 1.0, capital: 0.9 };
        const m = mults[settlement.type] || 1.0;
        return Math.floor(baseCost * m);
    },

    /* ── Save / Load ─────────────────────────────────────────── */

    prepareForSave(player) {
        // ships[] on player is already serializable
        // Restore _nextId from ships array
        if (player.ships && player.ships.length > 0) {
            let maxId = 0;
            for (const s of player.ships) {
                const num = parseInt((s.id || '').replace('ship_', ''), 10);
                if (!isNaN(num) && num > maxId) maxId = num;
            }
            Ships._nextId = maxId + 1;
        }
    },

    restoreFromSave(player) {
        if (player.ships && player.ships.length > 0) {
            let maxId = 0;
            for (const s of player.ships) {
                const num = parseInt((s.id || '').replace('ship_', ''), 10);
                if (!isNaN(num) && num > maxId) maxId = num;
            }
            Ships._nextId = maxId + 1;
        }
    },
};
