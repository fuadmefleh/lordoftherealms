
import { DataLoader } from '../core/dataLoader.js';
import { Hex } from '../core/hex.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../core/inventory.js';
import { Quests } from './quests.js';
import { Traits } from './traits.js';
import { Technology } from './technology.js';
import { WorldEvents } from '../world/worldEvents.js';
import { WEATHER_EFFECTS } from '../world/weather.js';
import { LegendaryArtifacts } from './legendaryArtifacts.js';
import { Infrastructure } from './infrastructure.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { Economy } from '../world/economy.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { Seasons } from '../world/seasons.js';
import { Underworld } from './underworld.js';
import { Ailments } from './ailments.js';
import { VoyageMethods } from './shipVoyages.js';

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

    /* ── Customization effects ───────────────────────────────── */
    // Ship stats from ships.json that act on play:
    //   armor (hull + Reinforced Hull)  — soaks hull damage: x 10/(10+armor)
    //   captureBonus (Boarding Planks)  — chance to seize a beaten pirate ship
    //                                     as a prize; bigger plunder hauls
    //   explorationBonus (Crow's Nest, Navigator's Quarters) — +10% sea
    //                                     rewards per point, finds pirates/prey sooner
    //   stealthBonus (Crow's Nest -1)   — piracy is noticed more/less (reputation)
    //   fishingBonus (Deep-Sea Nets)    — extra casts when fishing beside the ship
    //   renownBonus / charismaBonus (Luxury Cabin) — renown once when fitted,
    //                                     charisma while you own the ship

    /** Hull damage after armor. Always at least 1 for any real hit. */
    mitigateHullDamage(ship, damage) {
        if (!(damage > 0)) return 0;
        const armor = this.getShipEffectiveStats(ship).armor || 0;
        return Math.max(1, Math.round(damage * 10 / (10 + armor)));
    },

    /** Multiplier on gold from sea exploration: Navigation tech + the ship's fittings. */
    getExplorationMultiplier(player, ship) {
        const tech = player ? Technology.getEffectTotal(player, 'explorationBonus') : 0;
        const fitted = ship ? (this.getShipEffectiveStats(ship).effects.explorationBonus || 0) : 0;
        return 1 + tech + 0.1 * fitted;
    },

    /**
     * Extra fishing casts from Deep-Sea Nets on one of the player's ships
     * moored within a hex of (q, r) — the best such ship counts.
     */
    getFishingBonus(player, q, r, world = null) {
        let best = 0;
        for (const ship of (player && player.ships) || []) {
            if (!['docked', 'anchored', 'at_sea'].includes(ship.status)) continue;
            if (typeof ship.q !== 'number') continue;
            const dist = world && world.width
                ? Hex.wrappingDistance(q, r, ship.q, ship.r, world.width)
                : Hex.distance(q, r, ship.q, ship.r);
            if (dist > 1) continue;
            // Nets need hands to haul them: a short-handed ship nets fewer fish
            const nets = this.getShipEffectiveStats(ship).effects.fishingBonus || 0;
            best = Math.max(best, Math.floor(nets * this.getCrewRatio(ship)));
        }
        return best;
    },

    /** Add (sign 1) or remove (sign -1) the owner perks of fitted customizations. */
    _applyOwnerPerks(player, customizationIds, sign) {
        let renown = 0;
        let charisma = 0;
        for (const cid of customizationIds || []) {
            const c = this.getCustomization(cid);
            if (!c || !c.effects) continue;
            renown += c.effects.renownBonus || 0;
            charisma += c.effects.charismaBonus || 0;
        }
        // Renown is earned once, when the fitting is shown off
        if (sign > 0 && renown) player.renown = (player.renown || 0) + renown;
        if (charisma) player.charisma = Math.max(0, (player.charisma || 0) + sign * charisma);
        return { renown: sign > 0 ? renown : 0, charisma: sign * charisma };
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

    /* ── Naval techs ─────────────────────────────────────────── */

    /** Max ships the player may own (Shipbuilding raises it). */
    getFleetCapacity(player) {
        return Technology.getFleetCapacity(player);
    },

    /** Why the player can't add another ship, or null if they can. */
    fleetLimitReason(player) {
        const cap = this.getFleetCapacity(player);
        if ((player.ships || []).length < cap) return null;
        const hint = Technology.getEffectTotal(player, 'navalCapacity') > 0
            ? 'Sell a ship to make room.'
            : 'Implement Shipbuilding to command more.';
        return `Your fleet is at its limit of ${cap} ships. ${hint}`;
    },

    /** Hexes per day a ship sails, with Navigation's speed bonus. */
    getSailingSpeed(player, ship) {
        const base = this.getShipEffectiveStats(ship).speed;
        // The Astrolabe of Tides reads the currents for you
        const relic = player ? 1 + LegendaryArtifacts.getPassiveTotal(player, 'shipSpeed') : 1;
        // Too few hands on the oars and sheets: an undercrewed ship is slower
        const crew = this.getCrewSpeedFactor(ship);
        return Math.max(1, Math.round(base * relic * crew * (player ? Technology.getSailingSpeedMultiplier(player) : 1)));
    },

    /* ── Crew ────────────────────────────────────────────────── */
    // Ships need sailors (crewRequired). They are hired at ports and paid a
    // daily wage. A short-handed ship sails slower, fights worse and nets
    // fewer fish; below a skeleton crew it cannot leave port. Morale rests
    // at restingMorale; storms, defeats and missed wages lower it, victories
    // raise it, and sailors desert a ship whose morale falls too low.
    // Ships from older saves have no crew fields — they count as fully
    // crewed at resting morale (and restoreFromSave writes that in).

    _getCrewSettings() {
        const c = this._getSettings().crew || {};
        return {
            hireCostPerSailor: 12,
            wagePerSailorPerDay: 1,
            startingMorale: 70,
            restingMorale: 70,
            minCrewShare: 0.25,
            unpaidMoraleLoss: 15,
            desertionMorale: 25,
            desertionShare: 0.1,
            stormMoraleLoss: 6,
            stormOverboardChance: 0.3,
            victoryMorale: 6,
            victoryLossChance: 0.4,
            defeatMoraleLoss: 12,
            defeatLossShare: [0.1, 0.25],
            ...c,
        };
    },

    /** Sailors aboard (legacy ships without the field are fully crewed). */
    getCrew(ship) {
        if (ship && Number.isFinite(ship.crew)) return ship.crew;
        return this.getShipEffectiveStats(ship || {}).crewRequired;
    },

    getMorale(ship) {
        if (ship && Number.isFinite(ship.morale)) return ship.morale;
        return this._getCrewSettings().restingMorale;
    },

    /** Share of the required crew aboard, 0..1. */
    getCrewRatio(ship) {
        const need = this.getShipEffectiveStats(ship).crewRequired;
        return Math.max(0, Math.min(1, this.getCrew(ship) / need));
    },

    /** Skeleton crew needed to leave port at all. */
    getMinCrew(ship) {
        const need = this.getShipEffectiveStats(ship).crewRequired;
        return Math.max(1, Math.ceil(need * this._getCrewSettings().minCrewShare));
    },

    /** Why this ship cannot sail, or null if it can. */
    crewSailReason(ship) {
        const min = this.getMinCrew(ship);
        if (this.getCrew(ship) >= min) return null;
        return `${ship.name} needs at least ${min} sailors to leave port (has ${this.getCrew(ship)}). Hire crew at a port.`;
    },

    /** Speed multiplier: half speed with no crew, full speed fully crewed. */
    getCrewSpeedFactor(ship) {
        return 0.5 + 0.5 * this.getCrewRatio(ship);
    },

    /**
     * Fighting multiplier: 40% with no crew, 100% fully crewed, scaled by
     * morale around its resting value (100 morale: +15%, 0 morale: −35%).
     */
    getCrewCombatFactor(ship) {
        const s = this._getCrewSettings();
        const moraleMult = Math.max(0.5, 1 + (this.getMorale(ship) - s.restingMorale) / 200);
        return (0.4 + 0.6 * this.getCrewRatio(ship)) * moraleMult;
    },

    /** Stamina per hex while the player sails the ship: 2 fully crewed, up to 4 short-handed. */
    getSailHexCost(ship) {
        return Math.round(2 / this.getCrewSpeedFactor(ship));
    },

    /** Daily wages for the sailors aboard. */
    getDailyWages(ship) {
        return Math.round(this.getCrew(ship) * this._getCrewSettings().wagePerSailorPerDay);
    },

    /** Gold to sign on `count` sailors. */
    getHireCost(count) {
        return Math.max(0, Math.floor(count)) * this._getCrewSettings().hireCostPerSailor;
    },

    /** Write explicit crew fields onto a ship (backfill for older saves). */
    _ensureCrew(ship) {
        if (!Number.isFinite(ship.crew)) ship.crew = this.getCrew(ship);
        if (!Number.isFinite(ship.morale)) ship.morale = this.getMorale(ship);
    },

    _setMorale(ship, value) {
        ship.morale = Math.max(0, Math.min(100, Math.round(value)));
    },

    /**
     * Hire sailors for a ship docked at a port on the player's hex. `count`
     * defaults to filling every empty berth. New hands join at starting
     * morale, which blends into the ship's morale.
     */
    hireCrew(player, world, shipId, count = Infinity) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.status !== 'docked' || ship.q !== player.q || ship.r !== player.r) {
            return { success: false, message: 'Your ship must be docked where you stand.' };
        }
        if (!world || !this.isPortTile(world, ship.q, ship.r)) {
            return { success: false, message: 'Sailors sign on at ports, not on open coast.' };
        }
        this._ensureCrew(ship);
        const open = this.getShipEffectiveStats(ship).crewRequired - ship.crew;
        if (open <= 0) return { success: false, message: `${ship.name} is fully crewed.` };
        let n = Math.min(open, Math.max(0, Math.floor(count)));
        const each = this._getCrewSettings().hireCostPerSailor;
        n = Math.min(n, Math.floor((player.gold || 0) / each));
        if (n <= 0) return { success: false, message: `Not enough gold. Each sailor costs ${each}g to sign on.` };

        const cost = this.getHireCost(n);
        player.gold -= cost;
        const s = this._getCrewSettings();
        this._setMorale(ship, (ship.morale * ship.crew + s.startingMorale * n) / (ship.crew + n));
        ship.crew += n;
        if (player.financeToday) {
            player.financeToday.expenses.crewWages = (player.financeToday.expenses.crewWages || 0) + cost;
        }
        return { success: true, hired: n, cost, message: `Signed on ${n} sailor${n === 1 ? '' : 's'} for ${ship.name} (${cost}g).` };
    },

    /** Pay off sailors from a docked ship to save on wages. */
    dismissCrew(player, shipId, count = 1) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked to pay off crew.' };
        this._ensureCrew(ship);
        const n = Math.min(ship.crew, Math.max(0, Math.floor(count)));
        if (n <= 0) return { success: false, message: 'No crew to dismiss.' };
        ship.crew -= n;
        return { success: true, dismissed: n, message: `Paid off ${n} sailor${n === 1 ? '' : 's'} from ${ship.name}.` };
    },

    /**
     * Board a docked ship to sail it yourself. Needs a skeleton crew.
     */
    boardShip(player, shipId) {
        const ship = this.getShipById(player, shipId);
        if (!ship) return { success: false, message: 'Ship not found.' };
        if (ship.status !== 'docked') return { success: false, message: 'Ship must be docked to board.' };
        const noCrew = this.crewSailReason(ship);
        if (noCrew) return { success: false, message: noCrew };
        player.boardedShip = shipId;
        ship.status = 'at_sea';
        return { success: true, ship };
    },

    /**
     * Crew after a sea fight: a win lifts morale and may cost a sailor; a
     * defeat costs 10–25% of the crew and a big morale hit.
     * Returns { lost, moraleChange } and a short text for the battle report.
     */
    _crewAfterBattle(ship, won) {
        this._ensureCrew(ship);
        const s = this._getCrewSettings();
        const before = ship.morale;
        let lost = 0;
        if (won) {
            if (ship.crew > 1 && Utils.random() < s.victoryLossChance) lost = 1;
            this._setMorale(ship, ship.morale + s.victoryMorale);
        } else {
            const [lo, hi] = s.defeatLossShare;
            lost = Math.min(ship.crew, Math.ceil(ship.crew * Utils.randFloat(lo, hi)));
            this._setMorale(ship, ship.morale - s.defeatMoraleLoss);
        }
        ship.crew -= lost;
        const moraleChange = ship.morale - before;
        const text = lost > 0 ? ` ${lost} sailor${lost === 1 ? '' : 's'} lost.` : '';
        return { lost, moraleChange, text };
    },

    /* ── Naval squadron (War Galleys in the army) ────────────── */
    // Army units whose domain is "sea" (data/military.json → War Galley) never
    // fight inland. They escort the player's own ships (escortShare of their
    // strength joins every sea fight) and, through PlayerMilitary, blockade
    // coastal settlements and fight at full strength on the water.

    getNavalRules() {
        const rules = (typeof DataLoader !== 'undefined' && DataLoader.military && DataLoader.military.navalRules) || {};
        return {
            theatreWeights: {
                land: { land: 1, sea: 0 },
                coastal: { land: 1, sea: 0.5 },
                sea: { land: 0.5, sea: 1 },
                ...(rules.theatreWeights || {}),
            },
            escortShare: Number.isFinite(rules.escortShare) ? rules.escortShare : 0.5,
        };
    },

    /** Is this army unit a warship (domain "sea")? Older saves fall back to the unit type's data. */
    isNavalUnit(unit) {
        if (!unit) return false;
        if (unit.domain) return unit.domain === 'sea';
        const defs = (typeof DataLoader !== 'undefined' && DataLoader.military && DataLoader.military.unitTypes) || {};
        const def = Object.values(defs).find(d => d && d.id === unit.type);
        return !!(def && def.domain === 'sea');
    },

    /** The army's warships. */
    getSquadron(player) {
        return ((player && player.army) || []).filter(u => this.isNavalUnit(u));
    },

    /**
     * Fighting strength of the war-galley squadron: level, wounds, the
     * commander's combat skill and Naval Warfare drill all count.
     */
    getSquadronStrength(player) {
        const squadron = this.getSquadron(player);
        if (squadron.length === 0) return 0;
        const skill = 1 + ((player.skills && player.skills.combat) || 0) * 0.1;
        const drill = 1 + Technology.getEffectTotal(player, 'navalCombatBonus');
        let total = 0;
        for (const unit of squadron) {
            let s = (unit.strength || 0) * (1 + ((unit.level || 1) - 1) * 0.2);
            if (unit.woundedDays > 0) s *= 0.5;
            total += s;
        }
        return Math.floor(total * skill * drill);
    },

    /** Strength the squadron adds to each of the player's own ship fights. */
    getEscortStrength(player) {
        // Galleys lent to the liege's fleet are away at war, not escorting
        if (player && player.politics && player.politics.fleetService) return 0;
        return Math.floor(this.getSquadronStrength(player) * this.getNavalRules().escortShare);
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
        const fleetFull = this.fleetLimitReason(player);
        if (fleetFull) return { success: false, message: fleetFull };
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
            crew: 0, // the old crew is long gone — hire sailors at a port
            morale: this._getCrewSettings().startingMorale,
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
        return {
            success: true,
            message: `Purchased ${used.name} (${st ? st.name : 'ship'}) for ${used.price}g! She has no crew — hire sailors here before you sail.`,
        };
    },

    /* ── Commissioning a new ship ────────────────────────────── */

    commissionShip(player, q, r, typeId, name, customizationIds, world) {
        const st = this.getShipType(typeId);
        if (!st) return { success: false, message: 'Unknown ship type.' };

        const tile = world.getTile(q, r);
        if (!tile || !tile.settlement) return { success: false, message: 'Must be at a settlement.' };
        const fleetFull = this.fleetLimitReason(player);
        if (fleetFull) return { success: false, message: fleetFull };

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
            crew: 0, // hire sailors at a port before she can sail
            morale: this._getCrewSettings().startingMorale,
            dockedAt: tile.settlement.name,
            buildDaysLeft: st.buildDays,
            purchaseDay: world.day || 0,
        };
        player.ships.push(ship);
        this._applyOwnerPerks(player, validCustoms, 1);

        if (player.financeToday) {
            player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + totalCost;
        }

        return {
            success: true,
            message: `Commissioned ${st.icon} ${ship.name} for ${totalCost}g. Ready in ${st.buildDays} days — hire ${this.getShipEffectiveStats(ship).crewRequired} sailors at a port to crew her.`
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
        // Luxury fittings' charisma leaves with the ship
        this._applyOwnerPerks(player, ship.customizations, -1);

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
        this._applyOwnerPerks(player, quote.picked.map(c => c.id), 1);

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
        const noCrewMove = this.crewSailReason(ship);
        if (noCrewMove) return { success: false, message: noCrewMove };

        const dist = Hex.distance(ship.q, ship.r, destQ, destR);
        const speed = this.getSailingSpeed(player, ship);
        const travelDays = Math.max(1, Math.ceil(dist / speed));

        ship.status = 'moving';
        ship.destQ = destQ;
        ship.destR = destR;
        ship.destinationName = destName;
        ship.travelDaysLeft = travelDays;

        return { success: true, message: `${ship.name} is sailing to ${destName}. ETA: ${travelDays} days.` };
    },

    /* ── Player sails on their ship ──────────────────────────── */

    /**
     * Set out with the player aboard for a port. The voyage takes real days
     * (systems/shipVoyages.js): each day's tick moves the ship along a sea
     * route, feeds the crew and may bring an event at sea.
     */
    sailPlayerTo(player, shipId, destQ, destR, destName, world) {
        return this.startVoyage(player, world, shipId, destQ, destR, destName);
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

    /**
     * Somewhere ships can berth and cargo moves freely: a port, or a
     * finished jetty the player has built on open coast. Unlike a port, a
     * jetty has no market.
     */
    hasDock(world, q, r) {
        if (this.isPortTile(world, q, r)) return true;
        const tile = world.getTile(q, r);
        return Infrastructure.hasDock(tile) && Hex.neighbors(q, r).some(n => this.isWaterTile(world.getTile(n.q, n.r)));
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
     * shore at (q, r). Unlimited at a port or jetty; elsewhere the boat
     * moves LANDING_BOAT_CAPACITY units per ship per day, in either direction.
     */
    getFerryAllowance(ship, world, q, r) {
        if (this.hasDock(world, q, r)) return Infinity;
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
                    : 'The boat has made all its trips today — a port or jetty has no such limit.';
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
            return { success: false, message: 'The boat has made all its trips today — a port or jetty has no such limit.' };
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
        const leftAboard = {};
        let budget = maxUnits;
        let total = 0;
        if (!player.inventory) player.inventory = {};
        for (const [item, qty] of Object.entries(ship.cargo || {})) {
            if (budget <= 0) break;
            if (itemId && item !== itemId) continue;
            const take = Math.min(qty, budget);
            if (take <= 0) continue;
            // A new kind of good needs a free slot in the packs; otherwise it stays aboard
            if (!PlayerInventory.addItem(player, item, take).success) { leftAboard[item] = qty; continue; }
            ship.cargo[item] = qty - take;
            if (ship.cargo[item] <= 0) delete ship.cargo[item];
            moved[item] = take;
            budget -= take;
            total += take;
        }
        return { moved, total, remaining: this.getCargoUsed(ship), leftAboard, packsFull: Object.keys(leftAboard).length > 0 };
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
        const isPort = this.hasDock(world, player.q, player.r);
        if (ship.voyage) this._endVoyage(ship, world, 'Went ashore before the voyage was done.');
        player.boardedShip = null;
        ship.status = 'docked';
        ship.q = player.q;
        ship.r = player.r;
        ship.dockedAt = !isPort ? null : tile.settlement ? tile.settlement.name : 'Jetty';
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

        if (ship.voyage) this._endVoyage(ship, world, 'Rowed ashore before the voyage was done.');
        ship.status = 'anchored';
        ship.q = player.q;
        ship.r = player.r;
        ship.dockedAt = null;
        player.boardedShip = null;
        player.q = dest.q;
        player.r = dest.r;
        player.path = null;

        const isPort = this.hasDock(world, dest.q, dest.r);
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
                const shipStr = this._getShipCombatStrength(ship, player);

                const won = shipStr * (0.8 + Utils.random() * 0.4) > enemyStr * (0.8 + Utils.random() * 0.4);
                const crewToll = this._crewAfterBattle(ship, won);
                if (won) {
                    resultText += ' You fought and won!' + crewToll.text;
                    resultType = 'success';
                    Quests.track(player, 'battles_won');
                    Traits.recordDeed(player, 'seafaring', 2);
                    if (event.id === 'sea_monster') Quests.track(player, 'special_creatures_defeated');
                    if (event.id === 'pirate_ambush') {
                        Quests.track(player, 'raiders_defeated');
                        Quests.track(player, 'pirates_defeated');
                    }
                    // Give rewards
                    if (event.reward) this._applyReward(player, event.reward, ship);
                } else {
                    resultText += ' You were overwhelmed!' + crewToll.text;
                    resultType = 'error';
                    const dmg = event.danger.damage
                        ? (Array.isArray(event.danger.damage)
                            ? event.danger.damage[0] + Math.floor(Utils.random() * (event.danger.damage[1] - event.danger.damage[0]))
                            : event.danger.damage)
                        : 10;
                    ship.condition = Math.max(5, ship.condition - this.mitigateHullDamage(ship, dmg));
                    player.health = Math.max(1, player.health - Math.floor(dmg / 2));
                    const wound = Ailments.maybeWound(player, world, 'sea_battle');
                    if (wound) resultText += ` ${wound.icon} You took ${wound.name.toLowerCase()} in the fighting.`;
                }
            } else if (event.danger.damage) {
                const dmg = Array.isArray(event.danger.damage)
                    ? event.danger.damage[0] + Math.floor(Utils.random() * (event.danger.damage[1] - event.danger.damage[0]))
                    : event.danger.damage;
                const hullDmg = this.mitigateHullDamage(ship, dmg);
                ship.condition = Math.max(5, ship.condition - hullDmg);
                resultType = 'warning';
                resultText += ` Ship took ${hullDmg}% damage.`;
            }
        } else if (event.reward) {
            this._applyReward(player, event.reward, ship);
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
        const shipStr = this._getShipCombatStrength(ship, player);
        const fx = this.getShipEffectiveStats(ship).effects;

        // 50% chance to find pirates (lookouts and charts find them sooner)
        if (Utils.random() < Math.max(0.2, 0.5 - 0.05 * (fx.explorationBonus || 0))) {
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

        const crewToll = this._crewAfterBattle(ship, playerPower > enemyPower);
        if (playerPower > enemyPower) {
            Quests.track(player, 'battles_won');
            Quests.track(player, 'raiders_defeated');
            Quests.track(player, 'pirates_defeated');
            const loot = enemyStrength * (2 + Math.floor(Utils.random() * 4));
            player.gold += loot;
            player.karma = (player.karma || 0) + 2;
            player.renown = (player.renown || 0) + 3;
            ship.condition = Math.max(5, ship.condition - this.mitigateHullDamage(ship, Math.floor(Utils.random() * 5 + 2)));

            // Boarding planks: board the beaten pirate and sell her as a prize
            let prize = 0;
            if (fx.captureBonus > 0 && Utils.random() < fx.captureBonus) {
                prize = enemyStrength * 15;
                player.gold += prize;
            }

            if (player.financeToday) {
                player.financeToday.income.pirateBounty = (player.financeToday.income.pirateBounty || 0) + loot + prize;
            }

            return {
                success: true,
                icon: '⚔️',
                title: `Victory! Defeated pirates (str ${enemyStrength}) and claimed ${loot}g bounty! +3 renown, +2 karma.` +
                    (prize ? ` Your boarders seized their ship — sold as a prize for ${prize}g!` : '') + crewToll.text,
                type: 'success',
                prize,
            };
        } else {
            const dmg = this.mitigateHullDamage(ship, 5 + Math.floor(Utils.random() * 15));
            ship.condition = Math.max(5, ship.condition - dmg);
            player.health = Math.max(1, player.health - Math.floor(dmg / 2));
            const wound = Ailments.maybeWound(player, world, 'sea_battle');
            return {
                success: true,
                icon: '💀',
                title: `Defeated! The pirates were too strong (str ${enemyStrength}). Ship took ${dmg}% damage.${crewToll.text}` +
                    (wound ? ` ${wound.icon} You took ${wound.name.toLowerCase()} in the fighting.` : ''),
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

        const fx = this.getShipEffectiveStats(ship).effects;

        // 60% chance to find a target (better with lookouts and charts)
        if (Utils.random() < Math.max(0.15, 0.4 - 0.05 * (fx.explorationBonus || 0))) {
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
        const shipStr = this._getShipCombatStrength(ship, player);
        const playerPower = shipStr * (0.8 + Utils.random() * 0.4);
        const targetPower = targetStr * (0.8 + Utils.random() * 0.4);

        const crewToll = this._crewAfterBattle(ship, playerPower > targetPower);
        if (playerPower > targetPower) {
            // Boarding planks strip the prize more thoroughly
            const loot = Math.floor((goldRange[0] + Math.floor(Utils.random() * (goldRange[1] - goldRange[0]))) * (1 + (fx.captureBonus || 0)));
            player.gold += loot;
            player.karma = (player.karma || 0) - karmaLoss;
            player.renown = Math.max(0, (player.renown || 0) - renownLoss);
            Quests.track(player, 'piracy_committed'); // travelling companions take note
            ship.condition = Math.max(5, ship.condition - this.mitigateHullDamage(ship, Math.floor(Utils.random() * 3 + 1)));

            // Reputation loss with all kingdoms — a conspicuous ship (Crow's
            // Nest, stealth -1) is recognised more; a stealthy one less
            const repLoss = Math.max(1, 3 - (fx.stealthBonus || 0));
            for (const kId of Object.keys(player.reputation || {})) {
                player.reputation[kId] = (player.reputation[kId] || 0) - repLoss;
            }
            // The realm whose waters these were remembers: underworld heat
            Underworld.recordPiracy(player, world, typeof ship.q === 'number' ? ship.q : player.q, typeof ship.r === 'number' ? ship.r : player.r);

            if (player.financeToday) {
                player.financeToday.income.piracy = (player.financeToday.income.piracy || 0) + loot;
            }

            return {
                success: true,
                icon: '🏴‍☠️',
                title: `Plundered a merchant vessel for ${loot}g! -${karmaLoss} karma, -${renownLoss} renown. Your reputation suffers.${crewToll.text}`,
                type: 'warning'
            };
        } else {
            const dmg = this.mitigateHullDamage(ship, 5 + Math.floor(Utils.random() * 10));
            ship.condition = Math.max(5, ship.condition - dmg);
            player.karma = (player.karma || 0) - Math.floor(karmaLoss / 2);
            return {
                success: true,
                icon: '💀',
                title: `The merchant fought back hard! Failed to board. Ship took ${dmg}% damage.${crewToll.text}`,
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

    /** A player holding with a finished Harbour at (q, r). */
    _harbourAt(world, q, r) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        const fx = tile && tile.settlement && tile.settlement.holding && tile.settlement.holding.fx;
        return !!(fx && fx.port > 0);
    },

    /** Port-price bonus of a player holding's Harbour at (q, r) (settlement.holding.fx). */
    _harbourBonus(world, q, r) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        const fx = tile && tile.settlement && tile.settlement.holding && tile.settlement.holding.fx;
        return fx && fx.port > 0 ? (fx.portPrices || 0) : 0;
    },

    /**
     * What a port trades in. Each port is an exporter (cheap to buy, pays
     * little), importer (pays well, sells none) or local market for each
     * good; roles are fixed per port, prices drift every PORT_PRICE_PERIOD
     * days. Buy low at an exporter, sail, sell high at an importer.
     * @returns {Array<{id, name, icon, role, buy: number|null, sell: number}>}
     */
    /** Port price multiples of the land base price (data/ships.json → settings.portPrices). */
    _getPortPriceSettings() {
        return {
            export: [0.7, 0.9],
            exportResale: 0.75,
            local: [0.9, 1.1],
            localMarkup: 1.1,
            localResale: 0.85,
            import: [1.15, 1.5],
            ...(this._getSettings().portPrices || {}),
        };
    },

    /**
     * A sea good's land base price (data/playerEconomy.json GOODS), so ports
     * and the land economy share one scale; the trade good's own basePrice
     * is the fallback for goods the land economy doesn't know.
     */
    tradeGoodBasePrice(good) {
        const land = PlayerInventory.goodValue(good.id);
        return land > 0 ? land : (good.basePrice || 10);
    },

    getPortMarket(world, q, r) {
        const period = Math.floor((world.day || 0) / this.PORT_PRICE_PERIOD);
        const lerp = ([lo, hi], t) => lo + (hi - lo) * t;
        const P = this._getPortPriceSettings();
        // An enemy fleet off the harbour: prices suffer, or the port is shut
        const blockade = this.getPortBlockade(world, q, r);
        if (blockade && blockade.closed) return [];
        const tile = typeof world.getTile === 'function' ? world.getTile(q, r) : null;
        // The season moves sea goods as it moves land goods (fixed for the price period)
        const seasonDay = Number.isFinite(world.day) ? period * this.PORT_PRICE_PERIOD : null;
        const town = tile && tile.settlement;
        const market = this._getTradeGoods().filter(g => g.id).map((g, i) => {
            let roleRoll = this._hash(q, r, i) % 3;
            // The town's own stores (world/settlementMarket.js): a glut ships
            // out, a dearth is bought in — and prices follow the same stock
            const kept = town && town.market && SettlementMarket.tracks(g.id);
            const scarcity = kept ? SettlementMarket.scarcity(town, g.id) : 1;
            if (kept && scarcity <= 0.8) roleRoll = 0;
            else if (kept && scarcity >= 1.4) roleRoll = 1;
            // A town whose own market stocks the good doesn't import it
            if (roleRoll === 1 && tile && Economy.marketAsk(world, tile, g.id) != null) roleRoll = 2;
            const t = (this._hash(q, r, i, period) % 1000) / 1000;
            const basePrice = kept
                ? SettlementMarket.value(world, town, tile, g.id, this.tradeGoodBasePrice(g))
                : this.tradeGoodBasePrice(g) * Seasons.priceMultiplier(g.id, seasonDay);
            const base = { id: g.id, name: g.name, icon: g.icon || '📦', basePrice: Math.round(basePrice) };
            if (roleRoll === 0) {
                const buy = Math.max(2, Math.round(basePrice * lerp(P.export, t)));
                return { ...base, role: 'export', buy, sell: Math.max(1, Math.min(buy - 1, Math.round(buy * P.exportResale))) };
            }
            if (roleRoll === 1) {
                return { ...base, role: 'import', buy: null, sell: Math.max(1, Math.round(basePrice * lerp(P.import, t))) };
            }
            // Local market: about the base price, with a spread
            // (a port always charges more than it pays, so there's no same-port loop)
            const mid = basePrice * lerp(P.local, t);
            const buy = Math.max(2, Math.ceil(mid * P.localMarkup));
            return { ...base, role: 'local', buy, sell: Math.max(1, Math.min(buy - 1, Math.floor(mid * P.localResale))) };
        });
        // Your own Harbour (systems/holdings.js) gives you better terms here
        const harbour = this._harbourBonus(world, q, r);
        if (harbour > 0) {
            for (const e of market) {
                if (e.buy !== null) e.buy = Math.max(2, Math.round(e.buy * (1 - harbour)));
                e.sell = Math.max(1, Math.round(e.sell * (1 + harbour)));
                if (e.buy !== null) e.sell = Math.min(e.sell, e.buy - 1);
            }
        }
        if (!blockade) return market;
        const B = KingdomNavy.CONFIG.blockade;
        return market.map(e => {
            const buy = e.buy === null ? null : Math.max(2, Math.ceil(e.buy * B.marketBuy));
            const sell = Math.max(1, Math.floor(e.sell * B.marketSell));
            return { ...e, buy, sell: buy === null ? sell : Math.min(sell, buy - 1), blockaded: true };
        });
    },

    /**
     * The blockade over this port, if its realm's harbours are held by an
     * enemy fleet: { kingdom, blockaders, closed } or null.
     */
    getPortBlockade(world, q, r) {
        if (!world || typeof world.getTile !== 'function' || typeof world.getKingdom !== 'function') return null;
        return KingdomNavy.portBlockade(world, q, r);
    },

    _closedPortMessage(world, q, r) {
        const b = this.getPortBlockade(world, q, r);
        if (!b || !b.closed) return null;
        return `The harbour is closed: ${b.blockaders.map(k => k.name).join(' and ')} blockades the ports of ${b.kingdom.name}.`;
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
        const closedBuy = this._closedPortMessage(world, player.q, player.r);
        if (closedBuy) return { success: false, message: closedBuy };
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
        // What the town has in store goes first (the rest comes off foreign hulls)
        const portTown = world.getTile(player.q, player.r);
        if (portTown && portTown.settlement) SettlementMarket.take(portTown.settlement, goodId, n);
        if (player.financeToday) {
            player.financeToday.expenses.seaTrade = (player.financeToday.expenses.seaTrade || 0) + cost;
        }
        return { success: true, ship, bought: n, cost };
    },

    /**
     * What this port pays the player per unit for a market entry, with trade
     * bonuses — but never past what the same goods cost here: below the
     * port's own asking price, and at most half the town market's (the
     * least a player's discounts can buy them for).
     */
    portSaleUnitPrice(player, world, q, r, entry, qty = 1) {
        const portTile = world.getTile(q, r);
        // A big cargo of a good the town keeps floods its stores: each unit
        // fetches what the stock it finds commands (averaged over the lot)
        const town = portTile && portTile.settlement;
        let depth = 1;
        if (qty > 1 && town && town.market && SettlementMarket.tracks(entry.id)) {
            const s0 = SettlementMarket.stock(town, entry.id);
            let sum = 0;
            for (let j = 0; j < qty; j++) sum += SettlementMarket.levelFactor(town, entry.id, s0 + j);
            depth = sum / qty;
        }
        const eventMod = WorldEvents.getModifier(world, 'tradeIncome', portTile) + WorldEvents.getModifier(world, 'seaTradeIncome', portTile)
            // A Lighthouse you own beside the port brings ships in safely
            + (Technology.hasBuildingNear(player, world, 'lighthouse_building', q, r, 1) ? 0.15 : 0)
            // Lighthouse tech: charted harbours pay better at every port
            + Technology.getEffectTotal(player, 'portTradeBonus');
        const price = entry.sell * depth * (1 + Technology.getTradeProfitBonus(player)) * (1 + eventMod);
        // Never past what the same goods cost here or in a settlement next door
        const near = this.nearbyAsks(world, q, r, entry.id);
        let unitCap = entry.buy ? entry.buy - 1 : Infinity;
        if (near.port != null) unitCap = Math.min(unitCap, near.port - 1);
        if (near.market != null) unitCap = Math.min(unitCap, Math.floor(near.market * 0.5));
        return Math.max(0, Math.min(price, unitCap));
    },

    /**
     * The cheapest open asking prices for a good on (q, r) and in the
     * settlements on the hexes next to it: { market, port }, each null when
     * nobody there sells it. Every outlet that buys from the player caps its
     * price under these, so goods bought here or next door never sell
     * straight back for a profit. `skipHereMarket` leaves out this tile's own
     * town market (a good banned here isn't on its stalls). `markets` lists
     * each town market's ask with its settlement, for callers that apply the
     * player's discount there.
     */
    nearbyAsks(world, q, r, goodId, { skipHereMarket = false } = {}) {
        const out = { market: null, port: null, markets: [] };
        if (!world || typeof world.getTile !== 'function' || !goodId) return out;
        const W = world.width || 0;
        const spots = [{ q, r }, ...Hex.neighbors(q, r)];
        for (let i = 0; i < spots.length; i++) {
            const t = world.getTile(W ? Hex.wrapQ(spots[i].q, W) : spots[i].q, spots[i].r);
            if (!t || !t.settlement) continue;
            if (i > 0 || !skipHereMarket) {
                const ask = Economy.marketAsk(world, t, goodId);
                if (ask != null && (out.market == null || ask < out.market)) out.market = ask;
                if (ask != null) out.markets.push({ ask, settlement: t.settlement });
            }
            if (this.isPortTile(world, t.q, t.r)) {
                const e = this.getPortMarket(world, t.q, t.r).find(x => x.id === goodId);
                if (e && e.buy && (out.port == null || e.buy < out.port)) out.port = e.buy;
                // The ship's chandler sells provisions here too
                if (goodId === this._getProvisionSettings().item) {
                    const chandler = this.provisionPrice(world, t.q, t.r);
                    if (out.port == null || chandler < out.port) out.port = chandler;
                }
            }
        }
        return out;
    },

    /** Sell a trade good from a docked ship's hold to this port. */
    sellTradeGood(player, world, shipId, goodId, qty) {
        const ship = this._getShipAtPort(player, world, shipId);
        if (!ship) return { success: false, message: 'Your ship must be docked at this port.' };
        const closedSell = this._closedPortMessage(world, player.q, player.r);
        if (closedSell) return { success: false, message: closedSell };
        const entry = this.getPortMarket(world, player.q, player.r).find(e => e.id === goodId);
        if (!entry) return { success: false, message: 'Nobody here buys that.' };
        const n = Math.min(qty, (ship.cargo && ship.cargo[goodId]) || 0);
        if (n <= 0) return { success: false, message: 'None of that in the hold.' };
        const revenue = Math.max(0, Math.floor(n * this.portSaleUnitPrice(player, world, player.q, player.r, entry, n)));
        ship.cargo[goodId] -= n;
        if (ship.cargo[goodId] <= 0) delete ship.cargo[goodId];
        player.gold = (player.gold || 0) + revenue;
        // The cargo lands in the town's stores
        const portTown = world.getTile(player.q, player.r);
        if (portTown && portTown.settlement) SettlementMarket.add(portTown.settlement, goodId, n);
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
        const stormReports = [];
        const storms = {};

        for (const ship of ships) {
            // A Shipyard you own repairs docked ships beside it for free
            // ... and so does the Harbour of one of your holdings
            if (ship.status === 'docked' && world && ship.condition < 100
                && (Technology.hasBuildingNear(player, world, 'shipyard', ship.q, ship.r, 1) || this._harbourAt(world, ship.q, ship.r))) {
                ship.condition = Math.min(100, ship.condition + 5);
            }
            // Storms at sea batter hulls and hold ships back a day
            const storm = this._stormAtSea(ship, world);
            if (storm) storms[ship.id] = storm;
            if (storm) {
                const damage = this.mitigateHullDamage(ship, Math.round(Utils.randInt(3, 8) * storm.danger));
                ship.condition = Math.max(10, (ship.condition || 100) - damage);
                const report = { shipId: ship.id, name: ship.name, weather: storm.type, damage, delayed: false, cargoLost: null };
                if (ship.status === 'moving' && Utils.random() < 0.5 * storm.danger) {
                    ship.travelDaysLeft = (ship.travelDaysLeft || 0) + 1;
                    report.delayed = true;
                }
                // Heavy seas can wash part of the cargo overboard
                const goods = Object.keys(ship.cargo || {}).filter(g => ship.cargo[g] > 0);
                if (goods.length > 0 && Utils.random() < 0.2 * storm.danger) {
                    const good = Utils.randPick(goods);
                    const lost = Math.max(1, Math.floor(ship.cargo[good] * 0.2));
                    ship.cargo[good] -= lost;
                    if (ship.cargo[good] <= 0) delete ship.cargo[good];
                    report.cargoLost = { good, qty: lost };
                }
                // The crew is shaken, and a sailor may go over the side
                this._ensureCrew(ship);
                const crewCfg = this._getCrewSettings();
                this._setMorale(ship, ship.morale - Math.round(crewCfg.stormMoraleLoss * storm.danger));
                report.crewLost = 0;
                if (ship.crew > 0 && Utils.random() < crewCfg.stormOverboardChance * storm.danger) {
                    ship.crew -= 1;
                    report.crewLost = 1;
                }
                stormReports.push(report);
            }

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

            // Daily upkeep (pirate surges raise crew pay and escort costs)
            const shipTile = world && world.getTile && typeof ship.q === 'number' ? world.getTile(ship.q, ship.r) : null;
            const navalCost = world ? WorldEvents.getModifier(world, 'navalCost', shipTile) : 0;
            totalUpkeep += navalCost ? Math.round(st.dailyUpkeep * Math.max(0, 1 + navalCost)) : st.dailyUpkeep;

            // Condition decay
            if (Utils.random() < (settings.conditionDecayChance || 0.04)) {
                ship.condition = Math.max(10, ship.condition - 1);
            }
        }

        // Deduct total upkeep — never past an empty purse: what can't be
        // paid goes undone, and neglected hulls wear
        let upkeepShort = 0;
        if (totalUpkeep > 0) {
            const paidUpkeep = Math.min(totalUpkeep, Math.max(0, player.gold || 0));
            upkeepShort = totalUpkeep - paidUpkeep;
            player.gold -= paidUpkeep;
            if (player.financeToday && paidUpkeep > 0) {
                player.financeToday.expenses.ships = (player.financeToday.expenses.ships || 0) + paidUpkeep;
            }
            if (upkeepShort > 0) {
                for (const ship of ships) ship.condition = Math.max(10, (ship.condition || 100) - 1);
            }
        }

        // The player's voyage sails on (systems/shipVoyages.js)
        const voyageShip = this.getVoyageShip(player);
        const voyage = this._voyageDay(player, world, voyageShip ? storms[voyageShip.id] || null : null);

        // Hostile royal fleets stop ships sailing near their ports
        const interceptions = this._interceptShips(player, world);

        // Crews away from port eat from the hold
        const provisions = this._feedCrews(player, world);
        const crew = this._payCrews(player, ships);
        if (voyage) this._logVoyageDay(player, world, voyage, { stormReports, interceptions, provisions, crew });
        return { stormReports, crew, interceptions, upkeepShort, provisions, voyage };
    },

    /* ── Royal fleets at sea ─────────────────────────────────── */

    /**
     * How a realm's fleet regards the player's ships: 'war' (at war with the
     * player or the player's liege), 'hostile' (reputation at or below
     * intercept.hostileReputation) or null.
     */
    fleetHostility(player, world, kingdom) {
        if (!player || !kingdom || kingdom.id === player.allegiance) return null;
        if (player.realmWars && player.realmWars.wars && player.realmWars.wars[kingdom.id]) return 'war';
        const liege = player.allegiance && world && world.getKingdom ? world.getKingdom(player.allegiance) : null;
        if (liege && liege.isAlive && (liege.wars || []).includes(kingdom.id)) return 'war';
        const rep = (player.reputation && player.reputation[kingdom.id]) || 0;
        return rep <= KingdomNavy.CONFIG.intercept.hostileReputation ? 'hostile' : null;
    },

    /** Where a ship is on the map: the player's hex while aboard her. */
    _shipPosition(player, ship) {
        if (player && player.boardedShip === ship.id && typeof player.q === 'number') return { q: player.q, r: player.r };
        return { q: ship.q, r: ship.r };
    },

    /**
     * Each ship under way or at anchor within intercept.radius of a hostile
     * realm's port may be stopped by a detachment of its fleet. The ship's own
     * strength (hull, crew and the galley escort) decides the fight.
     * @returns {object[]} one report per interception
     */
    _interceptShips(player, world) {
        const reports = [];
        if (!world || !Array.isArray(world.kingdoms) || typeof world.getKingdom !== 'function') return reports;
        const I = KingdomNavy.CONFIG.intercept;
        for (const ship of player.ships || []) {
            if (!['at_sea', 'anchored', 'moving'].includes(ship.status)) continue;
            const pos = this._shipPosition(player, ship);
            if (typeof pos.q !== 'number') continue;
            const hostile = KingdomNavy.fleetsNear(world, pos.q, pos.r)
                .map(f => ({ ...f, stance: this.fleetHostility(player, world, f.kingdom) }))
                .find(f => f.stance);
            if (!hostile) continue;
            if (Utils.random() >= (hostile.stance === 'war' ? I.warChance : I.peaceChance)) continue;
            reports.push(this._fightInterception(player, world, ship, hostile.kingdom, hostile.stance));
        }
        return reports;
    },

    _fightInterception(player, world, ship, kingdom, stance) {
        const I = KingdomNavy.CONFIG.intercept;
        const detachment = KingdomNavy.detachment(kingdom);
        const own = this._getShipCombatStrength(ship, player);
        const won = own * Utils.randFloat(0.8, 1.2) > detachment * Utils.randFloat(0.8, 1.2);
        const toll = this._crewAfterBattle(ship, won);
        const report = { shipId: ship.id, name: ship.name, kingdomId: kingdom.id, kingdomName: kingdom.name, stance, won, detachment, strength: own, damage: 0, seized: {} };
        if (won) {
            kingdom.navy.strength = Math.max(0, (kingdom.navy.strength || 0) - Math.ceil(detachment * I.fleetLoss));
            report.damage = this.mitigateHullDamage(ship, Utils.randInt(1, 4));
            ship.condition = Math.max(5, (ship.condition || 100) - report.damage);
            player.renown = (player.renown || 0) + I.renown;
            const war = player.realmWars && player.realmWars.wars && player.realmWars.wars[kingdom.id];
            if (war) war.score = (war.score || 0) + I.warScore;
            report.text = `${ship.name} beat off a ${kingdom.name} squadron (strength ${detachment}) near their waters. +${I.renown} renown${war ? `, +${I.warScore} war score` : ''}.${toll.text}`;
        } else {
            report.damage = this.mitigateHullDamage(ship, Utils.randInt(8, 20));
            ship.condition = Math.max(5, (ship.condition || 100) - report.damage);
            for (const [good, qty] of Object.entries(ship.cargo || {})) {
                const taken = Math.floor(qty * I.cargoSeized);
                if (taken <= 0) continue;
                ship.cargo[good] -= taken;
                if (ship.cargo[good] <= 0) delete ship.cargo[good];
                report.seized[good] = taken;
            }
            const seized = Object.entries(report.seized).map(([g, n]) => `${n} ${g}`).join(', ');
            report.text = `A ${kingdom.name} squadron (strength ${detachment}) ran down ${ship.name}: hull -${report.damage}%${seized ? `, seized ${seized}` : ''}.${toll.text}`;
        }
        return report;
    },

    /**
     * Pay every crew its daily wage, then settle morale: paid crews drift
     * back toward resting morale (faster in harbour), unpaid crews sour, and
     * a share of any crew whose morale has collapsed deserts.
     * Returns { wages, paid, deserted: [{ shipId, name, count }] }.
     */
    _payCrews(player, ships) {
        const cfg = this._getCrewSettings();
        let wages = 0;
        for (const ship of ships) {
            this._ensureCrew(ship);
            wages += this.getDailyWages(ship);
        }
        const paid = wages <= 0 || (player.gold || 0) >= wages;
        if (paid && wages > 0) {
            player.gold -= wages;
            if (player.financeToday) {
                player.financeToday.expenses.crewWages = (player.financeToday.expenses.crewWages || 0) + wages;
            }
        }

        const deserted = [];
        for (const ship of ships) {
            if (ship.crew <= 0) continue;
            if (!paid) {
                this._setMorale(ship, ship.morale - cfg.unpaidMoraleLoss);
            } else if (ship.morale < cfg.restingMorale) {
                // Shore leave in a harbour mends spirits faster than the open sea
                this._setMorale(ship, Math.min(cfg.restingMorale, ship.morale + (ship.status === 'docked' ? 3 : 1)));
            } else if (ship.morale > cfg.restingMorale) {
                this._setMorale(ship, ship.morale - 1);
            }
            if (ship.morale < cfg.desertionMorale) {
                const count = Math.min(ship.crew, Math.max(1, Math.ceil(ship.crew * cfg.desertionShare)));
                ship.crew -= count;
                deserted.push({ shipId: ship.id, name: ship.name, count });
            }
        }
        return { wages, paid, deserted };
    },

    /**
     * A storm or blizzard on the open sea around a sailing or anchored ship.
     * Ships under way are checked at both ends of the voyage; a docked ship
     * rides it out in harbour. Returns { type, danger } or null.
     */
    _stormAtSea(ship, world) {
        if (!world || !world.weather || !['moving', 'at_sea', 'anchored'].includes(ship.status)) return null;
        const spots = [[ship.q, ship.r]];
        if (ship.status === 'moving' && typeof ship.destQ === 'number') spots.push([ship.destQ, ship.destR]);
        let worst = null;
        for (const [q, r] of spots) {
            if (typeof q !== 'number') continue;
            const w = world.weather.getWeather(q, r);
            const danger = WEATHER_EFFECTS[w.type]?.seaDanger || 0;
            if (danger > 0 && (!worst || danger > worst.danger)) worst = { type: w.type, danger };
        }
        return worst;
    },

    /* ── Combat helpers ──────────────────────────────────────── */

    _getShipCombatStrength(ship, player = null) {
        const stats = this.getShipEffectiveStats(ship);
        let strength = stats.combatStrength;

        // Naval Warfare drills your crews for battle at sea
        const navalBonus = player ? Technology.getEffectTotal(player, 'navalCombatBonus') : 0;
        if (navalBonus > 0) strength *= 1 + navalBonus;

        // Condition penalty
        strength *= ship.condition / 100;
        // Short-handed or demoralised crews fight worse
        strength = Math.floor(strength * this.getCrewCombatFactor(ship));
        // War galleys in the army sail alongside as escorts
        if (player) strength += this.getEscortStrength(player);
        return Math.max(1, strength);
    },

    /* ── Reward helper ───────────────────────────────────────── */

    _applyReward(player, reward, ship = null) {
        if (reward.gold) {
            const rolled = Array.isArray(reward.gold)
                ? reward.gold[0] + Math.floor(Utils.random() * (reward.gold[1] - reward.gold[0]))
                : reward.gold;
            // Navigation (tech) and the ship's charts and lookouts make the most of what the sea offers
            const amt = Math.floor(rolled * this.getExplorationMultiplier(player, ship));
            player.gold += amt;
            if (player.financeToday) {
                player.financeToday.income.exploration = (player.financeToday.income.exploration || 0) + amt;
            }
        }
        if (reward.renown) player.renown = (player.renown || 0) + reward.renown;
        if (reward.karma) player.karma = (player.karma || 0) + reward.karma;
        // Extra travel today (stamina itself refills each morning)
        if (reward.stamina) player.movementRemaining = (player.movementRemaining || 0) + reward.stamina;
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
        // Saves from before crews existed: those ships sailed fully manned,
        // so they keep a full crew at resting morale
        for (const ship of player.ships || []) {
            this._ensureCrew(ship);
            // ...and provisions/voyage fields from before voyages took days
            this._backfillVoyage(player, ship);
        }
        // ...and their war galleys learn they belong at sea
        for (const unit of player.army || []) {
            if (!unit.domain && this.isNavalUnit(unit)) unit.domain = 'sea';
        }
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

// Provisions, voyages that take real days, and events at sea
Object.assign(Ships, VoyageMethods);
