// ============================================
// HOLDING SIEGES — enemy realms besiege the player's holdings
// ============================================
// The player's own sieges (systems/sieges.js) run in reverse here. A war host
// of a realm at war with the player (systems/realmWars.js) that reaches one of
// the player's holdings (systems/holdings.js: a colony or a town held in the
// player's own name) no longer settles it with a single roll: it *invests* the
// town and the siege runs day by day.
//
//   DEFENDERS  the holding's garrison (its guard, a share of its people, the
//              stationed troops and militia), its walls and towers (the
//              holding's defence effects, governor included) with an
//              integrity the besiegers batter down, food stores (size,
//              season, granary — as Sieges.storesOf reckons them; a port the
//              enemy has no fleet to close eats them at half pace) and morale
//              (happiness, loyalty, the governor).
//   BESIEGERS  the war host (still a world unit on the holding's tile) with
//              its own stores, morale and camp sickness. They build a ram,
//              batter the walls, and storm when the odds are good; they give
//              up when they starve, lose heart or bleed away.
//   THE PLAYER relieves it (fights the host at the holding with the usual
//              combat — the garrison sallies to help), sends gold or food (a
//              caravan, or a ship to a port; either may be caught), orders the
//              governor to sally or to treat with the besiegers, buys the host
//              off (priced from the war's peace price) or sues for peace, or
//              lets the town fall.
//   OUTCOMES   relieved (the host broken), held (the besiegers give up),
//              terms / bought off (they march away), or fallen (the town
//              goes to the enemy through RealmWars' capture path; Holdings
//              then sees it lost; the House chronicle records it).
//
// State lives on player.realmWars.besieged (keyed "q,r", saved with the
// player's war record) with history and stats beside it. Randomness flows
// through Utils only, and nothing is drawn unless a holding is under siege.
// Tuning: these defaults, with data/military.json → holdingSieges laid over.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Economy } from '../world/economy.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { House } from './house.js';
import { Holdings } from './holdings.js';
import { Sieges } from './sieges.js';
import { RealmWars } from './realmWars.js';
import { Quests } from './quests.js';
import { PlayerMilitary } from '../player/playerMilitary.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => (world && world.day) || 0;
const _key = (q, r) => `${q},${r}`;
const _r1 = (v) => Math.round(v * 10) / 10;

/** Built-in tuning; data/military.json → holdingSieges overrides it key by key. */
const DEFAULTS = {
    presence: 1,                 // hexes from the holding at which the player can lead a relief
    morale: {
        base: 45, happiness: 0.4, loyalty: 0.3, martial: 3, govLoyalty: 0.1, walls: 20, min: 15, max: 95,
        daily: 1, martialDaily: 0.1, starving: 6, sick: 2,
        reliefNear: 2, reliefRange: 4, reliefMinRatio: 0.5,
        repelled: 8, refused: 3, sallyWon: 6, sallyLost: 10,
        goldPerPoint: 25, suppliedMax: 15, fed: 3,
    },
    starvingLoss: 0.03,
    disease: { lowStores: 0.25, lowChance: 0.05, starvingChance: 0.12, garrisonLoss: 0.02, popLoss: 0.005 },
    portSea: 0.5,                // a port the enemy can't close eats its stores at this pace
    fleetMin: 10,                // enemy navy strength that closes the harbour
    foodPerDay: { perPop: 50, min: 4 },
    besiegers: {
        stores: [18, 28], morale: 70, boredomAfter: 15, boredom: 0.5,
        hungerLoss: 0.04, hungerMorale: 5,
        disease: { perDay: 0.003, max: 0.06, days: [4, 8], loss: 0.03, morale: 2 },
        giveUpShare: 0.4, maxDays: 60, returnShare: 0.8,
    },
    ramDays: 3, batter: 4, ramDefense: 0.85,
    storm: {
        after: 3, strong: 1.5, strongChance: 0.5, even: 1.0, evenChance: 0.2,
        starvingRatio: 0.8, starvingChance: 0.15, attack: [0.8, 1.2], defense: [0.8, 1.3],
        besiegerLoss: 0.15, besiegerMorale: 15, garrisonLoss: 0.08, wallDamage: 10, moraleFloor: 0.55,
    },
    sally: { share: 0.4, perMartial: 0.05, lines: 0.35, roll: [0.8, 1.2], cooldown: 4, besiegerLoss: 0.12, besiegerMorale: 12, garrisonLoss: 0.05, failLoss: 0.4 },
    terms: { cooldown: 3, base: 0.1, morale: 0.4, hungry: 0.2, intrigue: 0.02, stewardship: 0.01, ratio: 0.1, min: 0.02, max: 0.9, pricePerStrength: 2 },
    buyOff: { peaceShare: 0.5, perStrength: 1.5 },
    supply: { caravanSpeed: 4, shipSpeed: 6, caravanCatch: 0.3, shipCatch: 0.12, fleetCatch: 0.35, goldPerGarrison: 10, maxGold: 1000, maxFood: 300 },
    relief: { sallyMorale: 40, sallyShare: 0.25, failMorale: 10 },
    outcome: { relievedLoyalty: 10, relievedHappiness: 5, heldLoyalty: 5, heldScore: 10 },
    historyCap: 12,
    logCap: 10,
};

const OUTCOMES = ['relieved', 'held', 'terms', 'bought', 'fallen', 'lifted'];

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
            ? _merge(base[k], v) : v;
    }
    return out;
}

let _cfgCache = null;
let _cfgSource = null;

export const HoldingSieges = {
    DEFAULTS,
    OUTCOMES,

    config() {
        const src = DataLoader.military && DataLoader.military.holdingSieges;
        if (!_cfgCache || _cfgSource !== src) {
            _cfgCache = _merge(DEFAULTS, src || {});
            _cfgSource = src;
        }
        return _cfgCache;
    },

    // ── State ───────────────────────────────────────────────────

    _blankStats() {
        return { besieged: 0, relieved: 0, held: 0, terms: 0, bought: 0, fallen: 0, lifted: 0 };
    },

    /** The siege ledger on player.realmWars (created and backfilled on demand). */
    state(player) {
        const s = RealmWars._state(player);
        if (!s.besieged || typeof s.besieged !== 'object' || Array.isArray(s.besieged)) s.besieged = {};
        if (!Array.isArray(s.siegeHistory)) s.siegeHistory = [];
        s.siegeStats = { ...HoldingSieges._blankStats(), ...(s.siegeStats || {}) };
        return s;
    },

    /** Every holding under siege: [siege]. Draws nothing, creates nothing. */
    list(player) {
        const b = player && player.realmWars && player.realmWars.besieged;
        return b && typeof b === 'object' ? Object.values(b) : [];
    },

    at(player, q, r) {
        const b = player && player.realmWars && player.realmWars.besieged;
        return (b && b[_key(q, r)]) || null;
    },

    /** Backfill after a load (older saves have no siege ledger; numbers made safe). */
    loadState(player) {
        if (!player || !player.realmWars) return;
        const st = HoldingSieges.state(player);
        for (const s of Object.values(st.besieged)) {
            for (const k of ['besiegers', 'besiegersStart', 'besiegerStores', 'besiegerMorale', 'besiegerSick', 'garrison', 'garrisonStart',
                'walls', 'wallHp', 'stores', 'storesStart', 'morale', 'ram', 'assaults', 'nextSallyDay', 'nextParleyDay', 'startDay']) {
                s[k] = _num(s[k]);
            }
            s.ramBuilt = !!s.ramBuilt;
            s.townSick = !!s.townSick;
            s.port = !!s.port;
            s.convoys = Array.isArray(s.convoys) ? s.convoys : [];
            s.log = Array.isArray(s.log) ? s.log : [];
            s.flags = s.flags && typeof s.flags === 'object' ? s.flags : {};
        }
    },

    // ── Reading a holding ───────────────────────────────────────

    /** Fighting men inside the walls: the colony's guard, a share of the people, stationed troops, militia. */
    garrisonOf(settlement) {
        if (!settlement) return 1;
        const colony = settlement.colony;
        const base = _num(colony && colony.garrisonStrength) || 10;
        const h = settlement.holding;
        const troops = h ? Holdings.garrisonStrength(h) + _num(h.fx && h.fx.militia) : 0;
        return Math.max(1, Math.round(base + _num(settlement.population) * 0.01 + troops));
    },

    /** The walls and towers as a defence bonus (the holding's defence effects, governor included). */
    wallsOf(settlement) {
        return Math.max(0, Economy.holdingFx(settlement, 'defense'));
    },

    /** The governor, or the garrison captain when the seat is empty. */
    commander(settlement) {
        const g = settlement && settlement.holding && settlement.holding.governor;
        if (g) return { name: g.name, martial: _num(g.martial), intrigue: _num(g.intrigue), stewardship: _num(g.stewardship), loyalty: _num(g.loyalty, 50), governor: true };
        return { name: 'the garrison captain', martial: 2, intrigue: 1, stewardship: 1, loyalty: 50, governor: false };
    },

    /** The defenders' heart at the start: the people's happiness and loyalty, the governor, the walls. */
    moraleOf(settlement) {
        const M = HoldingSieges.config().morale;
        const happy = _num(settlement && settlement.happiness, 50);
        const loyal = settlement && settlement.colony && typeof settlement.colony.loyalty === 'number' ? settlement.colony.loyalty : 50;
        const c = HoldingSieges.commander(settlement);
        let m = M.base + (happy - 50) * M.happiness + (loyal - 50) * M.loyalty + HoldingSieges.wallsOf(settlement) * M.walls;
        if (c.governor) m += c.martial * M.martial + (c.loyalty - 50) * M.govLoyalty;
        return Utils.clamp(Math.round(m), M.min, M.max);
    },

    /** Food (from the packs or a convoy) that makes one day of stores. */
    foodPerDay(siege) {
        const F = HoldingSieges.config().foodPerDay;
        return Math.max(F.min, Math.ceil(_num(siege.population) / F.perPop));
    },

    /** Does the besieging realm have the ships to close the harbour? */
    enemyFleet(world, siege) {
        const k = world && world.getKingdom ? world.getKingdom(siege.kingdomId) : null;
        return KingdomNavy.effectiveStrength(k) >= HoldingSieges.config().fleetMin;
    },

    /** Days of stores eaten today. */
    consumption(world, siege) {
        return siege.port && !HoldingSieges.enemyFleet(world, siege) ? HoldingSieges.config().portSea : 1;
    },

    /** The walls' worth today, after the ram and the battering. */
    effectiveWalls(siege) {
        return siege.walls * Utils.clamp(siege.wallHp, 0, 100) / 100;
    },

    /** What the garrison fights a storm with. */
    stormDefense(siege) {
        const C = HoldingSieges.config();
        let d = siege.garrison * (1 + HoldingSieges.effectiveWalls(siege));
        if (siege.ramBuilt) d *= C.ramDefense;
        d *= C.storm.moraleFloor + (1 - C.storm.moraleFloor) * Utils.clamp(siege.morale, 0, 100) / 100;
        if (siege.stores <= 0) d *= 0.8;
        if (siege.townSick) d *= 0.85;
        return Math.max(1, Math.round(d));
    },

    /** Gold that makes the host march away, priced from the war's peace price. */
    buyOffPrice(player, world, siege) {
        const B = HoldingSieges.config().buyOff;
        const k = world.getKingdom ? world.getKingdom(siege.kingdomId) : null;
        const peace = k ? RealmWars.peacePrice(player, k) : 200;
        return Math.max(50, Math.round(peace * B.peaceShare + siege.besiegers * B.perStrength));
    },

    /** Gold the governor offers the besiegers' captain to leave (cheaper; they may refuse). */
    termsPrice(siege) {
        const T = HoldingSieges.config().terms;
        return Math.max(25, Math.round(siege.besiegers * T.pricePerStrength * (0.5 + Utils.clamp(siege.besiegerMorale, 0, 100) / 100)));
    },

    /** Chance the besiegers accept the governor's terms today. */
    termsChance(siege, settlement) {
        const T = HoldingSieges.config().terms;
        const c = HoldingSieges.commander(settlement);
        let p = T.base + (1 - Utils.clamp(siege.besiegerMorale, 0, 100) / 100) * T.morale;
        if (siege.besiegerStores <= 0) p += T.hungry;
        p += c.intrigue * T.intrigue + c.stewardship * T.stewardship;
        const ratio = HoldingSieges.stormDefense(siege) / Math.max(1, siege.besiegers);
        p += Utils.clamp((ratio - 1) * T.ratio, -0.1, 0.2);
        return Utils.clamp(p, T.min, T.max);
    },

    _hostUnit(world, siege) {
        return (world.units || []).find(u => u.id === siege.hostId && !u.destroyed) || null;
    },

    _war(player, siege) {
        return (player.realmWars && player.realmWars.wars && player.realmWars.wars[siege.kingdomId]) || null;
    },

    _settlement(world, siege) {
        const t = world && world.getTile ? world.getTile(siege.q, siege.r) : null;
        return (t && t.settlement) || null;
    },

    /** Supply routes from where the player stands: { caravan, ship } with days and the odds of capture. */
    supplyOptions(player, world, siege) {
        const C = HoldingSieges.config().supply;
        const dist = typeof player.q === 'number' ? Hex.wrappingDistance(player.q, player.r, siege.q, siege.r, world.width) : 0;
        const fleet = HoldingSieges.enemyFleet(world, siege);
        const hasShip = ((player.ships || []).length > 0);
        return {
            distance: dist,
            caravan: { days: Math.max(1, Math.ceil(dist / C.caravanSpeed)), catch: C.caravanCatch, can: true },
            ship: {
                days: Math.max(1, Math.ceil(dist / C.shipSpeed)),
                catch: Math.min(0.95, C.shipCatch + (fleet ? C.fleetCatch : 0)),
                can: siege.port && hasShip,
                reason: !siege.port ? 'Not a port' : !hasShip ? 'You have no ship' : '',
            },
        };
    },

    /** Everything the Holdings Under Siege panel shows for one siege. */
    describe(player, world, key) {
        const siege = player.realmWars && player.realmWars.besieged && player.realmWars.besieged[key];
        if (!siege) return null;
        const settlement = HoldingSieges._settlement(world, siege);
        const day = _day(world);
        const eat = HoldingSieges.consumption(world, siege);
        const dist = typeof player.q === 'number' ? Hex.wrappingDistance(player.q, player.r, siege.q, siege.r, world.width) : Infinity;
        const k = world.getKingdom ? world.getKingdom(siege.kingdomId) : null;
        const war = HoldingSieges._war(player, siege);
        return {
            siege,
            key,
            day: day - siege.startDay,
            defense: HoldingSieges.stormDefense(siege),
            effectiveWalls: HoldingSieges.effectiveWalls(siege),
            storesDaysLeft: eat > 0 ? Math.max(0, Math.floor(siege.stores / eat)) : null,
            eatsPerDay: eat,
            enemyFleet: HoldingSieges.enemyFleet(world, siege),
            foodPerDay: HoldingSieges.foodPerDay(siege),
            commander: HoldingSieges.commander(settlement),
            army: PlayerMilitary.getArmyStrength(player),
            distance: dist,
            canRelieve: dist <= HoldingSieges.config().presence && PlayerMilitary.getArmyStrength(player) > 0 && !player.boardedShip,
            buyOffPrice: HoldingSieges.buyOffPrice(player, world, siege),
            termsPrice: HoldingSieges.termsPrice(siege),
            termsChance: HoldingSieges.termsChance(siege, settlement),
            canParley: day >= siege.nextParleyDay,
            canSally: day >= siege.nextSallyDay,
            peacePrice: k && war && !war.civilWar ? RealmWars.peacePrice(player, k) : null,
            supply: HoldingSieges.supplyOptions(player, world, siege),
        };
    },

    // ── The siege begins ────────────────────────────────────────

    /**
     * A war host has reached a holding (RealmWars._tickWar). Invest it, or join
     * a siege already there. Returns { siege, text } or null when there is no
     * holding of the player's to besiege (RealmWars then strikes as before).
     */
    begin(player, world, kingdom, war, rec, unit) {
        const ref = Holdings.find(player, world, rec.targetQ, rec.targetR);
        if (!ref) return null;
        const C = HoldingSieges.config();
        const st = HoldingSieges.state(player);
        const key = _key(ref.q, ref.r);
        const day = _day(world);
        const settlement = ref.settlement;
        const existing = st.besieged[key];
        if (existing) {
            // Another host comes up: it joins the lines
            existing.besiegers += rec.strength;
            existing.besiegersStart += rec.strength;
            unit.destroyed = true;
            war.hosts = war.hosts.filter(h => h.id !== rec.id);
            const host = HoldingSieges._hostUnit(world, existing);
            if (host) host.strength = Math.round(existing.besiegers);
            const text = `${rec.name} joins the siege of ${settlement.name} (besiegers now ${Math.round(existing.besiegers)}).`;
            HoldingSieges._log(existing, world, text);
            return { siege: existing, text, joined: true };
        }
        Holdings.ensure(settlement);
        Holdings.refresh(settlement);
        const stores = Sieges.storesOf(settlement, world);
        const B = C.besiegers;
        const s = {
            key, q: ref.q, r: ref.r,
            name: settlement.name,
            population: _num(settlement.population),
            kingdomId: kingdom.id, kingdomName: kingdom.name,
            hostId: rec.id, hostName: rec.name,
            startDay: day,
            besiegers: rec.strength, besiegersStart: rec.strength,
            besiegerStores: Utils.randInt(B.stores[0], B.stores[1]),
            besiegerMorale: B.morale,
            besiegerSick: 0,
            garrison: HoldingSieges.garrisonOf(settlement),
            walls: Math.round(HoldingSieges.wallsOf(settlement) * 100) / 100,
            wallHp: 100,
            stores, storesStart: stores,
            morale: HoldingSieges.moraleOf(settlement),
            townSick: false,
            port: KingdomNavy.isPortTile(world, ref.q, ref.r),
            ram: 0, ramBuilt: false,
            assaults: 0,
            nextSallyDay: day, nextParleyDay: day,
            convoys: [],
            flags: {},
            log: [],
        };
        s.garrisonStart = s.garrison;
        st.besieged[key] = s;
        st.siegeStats.besieged++;
        rec.besieging = key;
        unit.strength = rec.strength;
        unit.besieging = key;
        const text = `${rec.name} (strength ${rec.strength}) lays siege to ${settlement.name}: ${s.garrison} defenders, ${Math.round(stores)} days of food. Relieve it, supply it, or pay them off — see Holdings Under Siege.`;
        HoldingSieges._log(s, world, `${rec.name} invests the town.`);
        if (player.house) House._chronicle(player.house, world, `${kingdom.name} lays siege to ${settlement.name}.`, ['war', 'siege']);
        return { siege: s, text };
    },

    // ── The daily tick ──────────────────────────────────────────

    /**
     * Advance every siege of the player's holdings a day. Call after
     * RealmWars.processDaily. Draws no randomness when no holding is besieged.
     * @returns {{ notices: Array<{title, text, type}>, ended: Array }}
     */
    processDay(world, player) {
        const out = { notices: [], ended: [] };
        const b = player && player.realmWars && player.realmWars.besieged;
        if (!world || !b || !Object.keys(b).length) return out;
        for (const s of Object.values(b)) HoldingSieges._tick(player, world, s, out);
        return out;
    },

    _tick(player, world, s, out) {
        const C = HoldingSieges.config();
        const day = _day(world);
        const kingdom = world.getKingdom ? world.getKingdom(s.kingdomId) : null;
        const war = HoldingSieges._war(player, s);
        if (!war || !kingdom || kingdom.isAlive === false) {
            HoldingSieges._end(player, world, s, 'lifted', `The siege of ${s.name} is over: ${s.kingdomName} is no longer at war with you.`, out);
            return;
        }
        const ref = Holdings.find(player, world, s.q, s.r);
        if (!ref) {
            HoldingSieges._sendHome(world, kingdom, war, s);
            HoldingSieges._end(player, world, s, 'lifted', `${s.name} is no longer yours; ${s.hostName} marches away.`, out);
            return;
        }
        const rec = war.hosts.find(h => h.id === s.hostId);
        if (!rec) {
            HoldingSieges._end(player, world, s, 'relieved', `${s.hostName} is gone from before ${s.name}.`, out);
            return;
        }
        let unit = HoldingSieges._hostUnit(world, s);
        if (!unit) unit = RealmWars._spawnUnit(world, kingdom, rec); // an older save, or a lost unit
        unit.besieging = s.key;
        const settlement = ref.settlement;

        HoldingSieges._convoysDay(player, world, s, out);
        HoldingSieges._defendersDay(player, world, s, settlement, out);
        HoldingSieges._besiegersDay(player, world, s, out);
        if (HoldingSieges._stormDay(player, world, s, kingdom, war, out)) return;

        if (s.morale <= 0 || s.garrison <= 0) {
            HoldingSieges._fall(player, world, s, kingdom, war, `Starving and broken, ${s.name} opens its gates to ${s.hostName}.`, out);
            return;
        }
        const B = C.besiegers;
        if (s.besiegerMorale <= 0 || s.besiegers < s.besiegersStart * B.giveUpShare || day - s.startDay >= B.maxDays) {
            const war2 = HoldingSieges._war(player, s);
            if (war2) war2.score += C.outcome.heldScore;
            HoldingSieges._sendHome(world, kingdom, war, s);
            HoldingSieges._end(player, world, s, 'held', `${s.hostName} gives up the siege of ${s.name} and marches home. The town held (+${C.outcome.heldScore} war score).`, out);
            return;
        }
        // The host's banner shows its true strength
        s.besiegers = Math.max(1, Math.round(s.besiegers));
        unit.strength = s.besiegers;
        rec.strength = s.besiegers;
    },

    _convoysDay(player, world, s, out) {
        if (!s.convoys.length) return;
        const day = _day(world);
        const C = HoldingSieges.config();
        const keep = [];
        for (const c of s.convoys) {
            if (day < c.arriveDay) { keep.push(c); continue; }
            const what = [c.food ? `${c.food} food` : '', c.gold ? `${c.gold} gold` : ''].filter(Boolean).join(' and ');
            if (Utils.random() < c.catch) {
                s.besiegerStores += c.food / HoldingSieges.foodPerDay(s);
                const text = `Your ${c.via === 'ship' ? 'supply ship' : 'supply caravan'} is caught by the besiegers of ${s.name}: ${what} lost.`;
                HoldingSieges._log(s, world, text);
                out.notices.push({ title: '🚫 Supplies Taken', text, type: 'error' });
                continue;
            }
            if (c.food) {
                s.stores = _r1(s.stores + c.food / HoldingSieges.foodPerDay(s));
                s.morale = Utils.clamp(s.morale + C.morale.fed, 0, 100);
            }
            if (c.gold) {
                s.garrison += Math.floor(c.gold / C.supply.goldPerGarrison);
                s.morale = Utils.clamp(s.morale + Math.min(C.morale.suppliedMax, c.gold / C.morale.goldPerPoint), 0, 100);
            }
            Quests.track(player, 'siege_supplies_delivered');
            const text = `Your ${c.via === 'ship' ? 'ship' : 'caravan'} slips into ${s.name} with ${what}.`;
            HoldingSieges._log(s, world, text);
            out.notices.push({ title: '📦 Supplies Through', text, type: 'success' });
        }
        s.convoys = keep;
    },

    _defendersDay(player, world, s, settlement, out) {
        const C = HoldingSieges.config();
        const M = C.morale;
        const D = C.disease;
        s.stores = Math.max(0, Math.round((s.stores - HoldingSieges.consumption(world, s)) * 100) / 100);
        const starving = s.stores <= 0;
        const c = HoldingSieges.commander(settlement);
        let dm = -M.daily + c.martial * M.martialDaily;
        if (starving) {
            dm -= M.starving;
            s.garrison = Math.max(0, Math.floor(s.garrison * (1 - C.starvingLoss)));
            if (!s.flags.starving) {
                s.flags.starving = true;
                out.notices.push({ title: '🍞 A Holding Starves', text: `${s.name} has eaten the last of its stores. The garrison is starving.`, type: 'error' });
            }
        } else if (!s.flags.low && s.stores <= s.storesStart * D.lowStores) {
            s.flags.low = true;
            out.notices.push({ title: '🍞 Stores Running Low', text: `${s.name} has ${Math.round(s.stores)} days of food left. Send supplies or relieve it.`, type: 'warning' });
        }
        if (!s.townSick) {
            const low = s.stores <= s.storesStart * D.lowStores;
            const chance = starving ? D.starvingChance : low ? D.lowChance : 0;
            if (chance > 0 && Utils.random() < chance) {
                s.townSick = true;
                const text = `Sickness breaks out inside besieged ${s.name}.`;
                HoldingSieges._log(s, world, text);
                out.notices.push({ title: '🤒 Disease in the Holding', text, type: 'warning' });
            }
        }
        if (s.townSick) {
            dm -= M.sick;
            s.garrison = Math.max(0, Math.floor(s.garrison * (1 - D.garrisonLoss)));
            settlement.population = Math.max(1, Math.floor(_num(settlement.population) * (1 - D.popLoss)));
        }
        // Your army on the march heartens them
        if (typeof player.q === 'number' && Hex.wrappingDistance(player.q, player.r, s.q, s.r, world.width) <= M.reliefRange
            && PlayerMilitary.getArmyStrength(player) >= s.besiegers * M.reliefMinRatio) {
            dm += M.reliefNear;
        }
        s.morale = Utils.clamp(_r1(s.morale + dm), 0, 100);
    },

    _besiegersDay(player, world, s, out) {
        const C = HoldingSieges.config();
        const B = C.besiegers;
        const day = _day(world);
        // Works: a ram, then the walls battered day after day
        if (!s.ramBuilt) {
            s.ram = _r1(s.ram + 1);
            if (s.ram >= C.ramDays) {
                s.ramBuilt = true;
                const text = `The besiegers of ${s.name} bring up a battering ram.`;
                HoldingSieges._log(s, world, text);
                out.notices.push({ title: '🐏 Siege Works', text, type: 'warning' });
            }
        } else if (s.walls > 0 && s.wallHp > 0) {
            s.wallHp = Math.max(0, s.wallHp - C.batter);
        }
        // Their camp eats
        s.besiegerStores = Math.max(0, _r1(s.besiegerStores - 1));
        if (s.besiegerStores <= 0) {
            s.besiegers *= 1 - B.hungerLoss;
            s.besiegerMorale -= B.hungerMorale;
        }
        if (day - s.startDay > B.boredomAfter) s.besiegerMorale -= B.boredom;
        // Camp fever
        const D = B.disease;
        if (s.besiegerSick > 0) {
            s.besiegerSick--;
            s.besiegers *= 1 - D.loss;
            s.besiegerMorale -= D.morale;
        } else {
            const chance = Math.min(D.max, D.perDay * (day - s.startDay));
            if (chance > 0 && Utils.random() < chance) {
                s.besiegerSick = Utils.randInt(D.days[0], D.days[1]);
                const text = `Sickness spreads through the enemy camp before ${s.name}.`;
                HoldingSieges._log(s, world, text);
                out.notices.push({ title: '🤒 Fever in the Enemy Camp', text, type: 'success' });
            }
        }
        s.besiegers = Math.max(1, _r1(s.besiegers));
        s.besiegerMorale = Utils.clamp(_r1(s.besiegerMorale), 0, 100);
    },

    /** The besiegers may storm the walls. Returns true when the town fell. */
    _stormDay(player, world, s, kingdom, war, out) {
        const C = HoldingSieges.config();
        const T = C.storm;
        if (_day(world) - s.startDay < T.after || !s.ramBuilt) return false;
        const defense = HoldingSieges.stormDefense(s);
        const ratio = s.besiegers / defense;
        const chance = ratio >= T.strong ? T.strongChance
            : ratio >= T.even ? T.evenChance
                : (s.stores <= 0 && ratio >= T.starvingRatio) ? T.starvingChance : 0;
        if (!(chance > 0) || !(Utils.random() < chance)) return false;
        s.assaults++;
        const att = s.besiegers * Utils.randFloat(T.attack[0], T.attack[1]);
        const def = defense * Utils.randFloat(T.defense[0], T.defense[1]);
        if (att > def) {
            HoldingSieges._fall(player, world, s, kingdom, war, `${s.hostName} storms the walls of ${s.name}. The town is lost to ${s.kingdomName}.`, out);
            return true;
        }
        s.besiegers = Math.max(1, _r1(s.besiegers * (1 - T.besiegerLoss)));
        s.besiegerMorale = Utils.clamp(s.besiegerMorale - T.besiegerMorale, 0, 100);
        s.garrison = Math.max(1, Math.round(s.garrison * (1 - T.garrisonLoss)));
        s.morale = Utils.clamp(s.morale + C.morale.repelled, 0, 100);
        s.wallHp = Math.max(0, s.wallHp - T.wallDamage);
        const text = `${s.hostName} storms ${s.name} and is thrown back from the walls.`;
        HoldingSieges._log(s, world, text);
        out.notices.push({ title: '🛡️ Assault Repelled', text, type: 'success' });
        return false;
    },

    // ── The player's options ────────────────────────────────────

    _get(player, key) {
        const siege = player.realmWars && player.realmWars.besieged && player.realmWars.besieged[key];
        return siege || null;
    },

    /**
     * March to relieve it: fight the besieging host at the holding with the
     * usual combat (PlayerMilitary.attackUnit); the garrison sallies to help
     * if its heart is still in it. Beating the host ends the siege (relieved).
     */
    relieve(player, world, key) {
        const s = HoldingSieges._get(player, key);
        if (!s) return { success: false, reason: 'That holding is not under siege.' };
        const C = HoldingSieges.config();
        if (player.boardedShip) return { success: false, reason: 'Go ashore first.' };
        if (Hex.wrappingDistance(player.q, player.r, s.q, s.r, world.width) > C.presence) {
            return { success: false, reason: `March your army to ${s.name} first.` };
        }
        if (PlayerMilitary.getArmyStrength(player) <= 0) return { success: false, reason: 'You have no army to relieve it with.' };
        const unit = HoldingSieges._hostUnit(world, s);
        if (!unit) return { success: false, reason: 'The besiegers are not to be found.' };
        const sally = s.morale >= C.relief.sallyMorale ? Math.round(s.garrison * C.relief.sallyShare) : 0;
        const full = unit.strength;
        unit.strength = Math.max(1, Math.round(full - sally * 0.5));
        const result = PlayerMilitary.attackUnit(player, unit, world);
        result.sally = sally;
        if (result.reason && !result.victory) {
            unit.strength = full;
            return { success: false, reason: result.reason };
        }
        result.success = true;
        if (!result.victory) {
            unit.strength = full;
            s.morale = Utils.clamp(s.morale - C.relief.failMorale, 0, 100);
            if (sally) s.garrison = Math.max(1, s.garrison - Math.round(sally * 0.3));
            const text = `Your relief of ${s.name} is beaten back. The siege goes on.`;
            HoldingSieges._log(s, world, text);
            result.message = text;
        } else {
            result.message = `${s.hostName} is broken before ${s.name}. The siege is lifted!`;
        }
        return result;
    },

    /**
     * Send gold and/or food (from the packs) to a besieged holding: by caravan,
     * or by ship to a port. It arrives in days and may be caught on the way in.
     */
    sendSupplies(player, world, key, opts = {}) {
        const s = HoldingSieges._get(player, key);
        if (!s) return { success: false, reason: 'That holding is not under siege.' };
        const C = HoldingSieges.config().supply;
        const via = opts.via === 'ship' ? 'ship' : 'caravan';
        const routes = HoldingSieges.supplyOptions(player, world, s);
        const route = routes[via];
        if (!route.can) return { success: false, reason: route.reason || 'No way to send it.' };
        const gold = Math.max(0, Math.min(C.maxGold, Math.floor(_num(opts.gold))));
        let food = Math.max(0, Math.min(C.maxFood, Math.floor(_num(opts.food))));
        if (!gold && !food) return { success: false, reason: 'Send gold or food.' };
        if (gold > _num(player.gold)) return { success: false, reason: `You have only ${Math.floor(_num(player.gold))} gold.` };
        if (food > Sieges._foodInPacks(player)) return { success: false, reason: `You carry only ${Sieges._foodInPacks(player)} food.` };
        player.gold = _num(player.gold) - gold;
        if (food) food = Sieges._eatFromPacks(player, food);
        const convoy = { via, gold, food, arriveDay: _day(world) + route.days, catch: route.catch };
        s.convoys.push(convoy);
        HoldingSieges._log(s, world, `A ${via === 'ship' ? 'ship' : 'caravan'} sets out with ${[food ? `${food} food` : '', gold ? `${gold} gold` : ''].filter(Boolean).join(' and ')}.`);
        return { success: true, convoy, days: route.days, catch: route.catch };
    },

    /** Order the governor (or the captain) to sally against the siege lines. */
    sally(player, world, key) {
        const s = HoldingSieges._get(player, key);
        if (!s) return { success: false, reason: 'That holding is not under siege.' };
        const C = HoldingSieges.config();
        const S = C.sally;
        const day = _day(world);
        if (day < s.nextSallyDay) return { success: false, reason: `The garrison can't sally again for ${s.nextSallyDay - day} day(s).` };
        const settlement = HoldingSieges._settlement(world, s);
        const c = HoldingSieges.commander(settlement);
        s.nextSallyDay = day + S.cooldown;
        const force = Math.max(1, Math.round(s.garrison * S.share));
        const power = force * (1 + c.martial * S.perMartial) * (0.6 + Utils.clamp(s.morale, 0, 100) / 100 * 0.6) * Utils.randFloat(S.roll[0], S.roll[1]);
        const lines = s.besiegers * S.lines * Utils.randFloat(S.roll[0], S.roll[1]);
        let text;
        const won = power > lines;
        if (won) {
            s.besiegers = Math.max(1, _r1(s.besiegers * (1 - S.besiegerLoss)));
            s.besiegerMorale = Utils.clamp(s.besiegerMorale - S.besiegerMorale, 0, 100);
            s.morale = Utils.clamp(s.morale + C.morale.sallyWon, 0, 100);
            s.garrison = Math.max(1, Math.round(s.garrison * (1 - S.garrisonLoss)));
            const burned = s.ramBuilt || s.ram > 0;
            s.ram = 0;
            s.ramBuilt = false;
            text = `${c.name} leads a sally from ${s.name}: the siege lines are cut up${burned ? ' and the ram is burned' : ''}.`;
        } else {
            s.garrison = Math.max(1, s.garrison - Math.round(force * S.failLoss));
            s.morale = Utils.clamp(s.morale - C.morale.sallyLost, 0, 100);
            text = `${c.name}'s sally from ${s.name} is driven back with losses.`;
        }
        HoldingSieges._log(s, world, text);
        HoldingSieges._sync(world, s);
        return { success: true, won, text };
    },

    /** Order the governor to treat with the besiegers: gold from your purse if they agree to leave. */
    negotiate(player, world, key) {
        const s = HoldingSieges._get(player, key);
        if (!s) return { success: false, reason: 'That holding is not under siege.' };
        const C = HoldingSieges.config();
        const day = _day(world);
        if (day < s.nextParleyDay) return { success: false, reason: `The besiegers won't parley again for ${s.nextParleyDay - day} day(s).` };
        const price = HoldingSieges.termsPrice(s);
        if (_num(player.gold) < price) return { success: false, reason: `The terms would cost ${price} gold.` };
        const settlement = HoldingSieges._settlement(world, s);
        const chance = HoldingSieges.termsChance(s, settlement);
        const c = HoldingSieges.commander(settlement);
        s.nextParleyDay = day + C.terms.cooldown;
        if (!(Utils.random() < chance)) {
            s.morale = Utils.clamp(s.morale - C.morale.refused, 0, 100);
            const text = `The besiegers of ${s.name} send ${c.name}'s envoy back unheard.`;
            HoldingSieges._log(s, world, text);
            return { success: true, accepted: false, chance, text };
        }
        player.gold -= price;
        const kingdom = world.getKingdom(s.kingdomId);
        const war = HoldingSieges._war(player, s);
        if (kingdom && war) HoldingSieges._sendHome(world, kingdom, war, s);
        const text = `${c.name} buys off the besiegers of ${s.name} for ${price} gold; ${s.hostName} marches away.`;
        const end = HoldingSieges._end(player, world, s, 'terms', text, null);
        return { success: true, accepted: true, chance, cost: price, text, end };
    },

    /** Pay the enemy to lift the siege (priced from the war's peace price). The war goes on. */
    buyOff(player, world, key) {
        const s = HoldingSieges._get(player, key);
        if (!s) return { success: false, reason: 'That holding is not under siege.' };
        const price = HoldingSieges.buyOffPrice(player, world, s);
        if (_num(player.gold) < price) return { success: false, reason: `Need ${price} gold.` };
        player.gold -= price;
        const kingdom = world.getKingdom(s.kingdomId);
        const war = HoldingSieges._war(player, s);
        if (kingdom && war) HoldingSieges._sendHome(world, kingdom, war, s);
        if (kingdom) kingdom.treasury = _num(kingdom.treasury) + price;
        const text = `${s.kingdomName} takes ${price} gold to lift the siege of ${s.name}.`;
        const end = HoldingSieges._end(player, world, s, 'bought', text, null);
        return { success: true, cost: price, text, end };
    },

    /** Let it fall: the town opens its gates. */
    yieldHolding(player, world, key) {
        const s = HoldingSieges._get(player, key);
        if (!s) return { success: false, reason: 'That holding is not under siege.' };
        const kingdom = world.getKingdom(s.kingdomId);
        const war = HoldingSieges._war(player, s);
        if (!kingdom || !war) return { success: false, reason: 'No war to yield to.' };
        const out = { notices: [], ended: [] };
        HoldingSieges._fall(player, world, s, kingdom, war, `On your order ${s.name} opens its gates to ${s.hostName}.`, out);
        return { success: true, text: out.ended[0] && out.ended[0].text };
    },

    // ── Hooks from RealmWars ────────────────────────────────────

    /** The player broke a besieging host (RealmWars.onHostDefeated): the siege is relieved. */
    onHostDefeated(player, world, rec) {
        const s = rec && rec.besieging ? HoldingSieges._get(player, rec.besieging) : null;
        if (!s) return null;
        return HoldingSieges._end(player, world, s, 'relieved', `${s.hostName} is broken. The siege of ${s.name} is lifted!`, null);
    },

    /** A war ended (RealmWars.endWar): its sieges are lifted. */
    onWarEnded(player, world, kingdomId) {
        for (const s of HoldingSieges.list(player).filter(x => x.kingdomId === kingdomId)) {
            HoldingSieges._end(player, world, s, 'lifted', `With the war over, the siege of ${s.name} is lifted.`, null);
        }
    },

    // ── Endings ─────────────────────────────────────────────────

    _sync(world, s) {
        const unit = HoldingSieges._hostUnit(world, s);
        if (unit) unit.strength = Math.max(1, Math.round(s.besiegers));
    },

    /** The host marches home with what is left of it. */
    _sendHome(world, kingdom, war, s) {
        const unit = HoldingSieges._hostUnit(world, s);
        if (unit) unit.destroyed = true;
        war.hosts = war.hosts.filter(h => h.id !== s.hostId);
        kingdom.military = _num(kingdom.military) + Math.round(s.besiegers * HoldingSieges.config().besiegers.returnShare);
    },

    /** The town falls to the enemy through RealmWars' capture path. */
    _fall(player, world, s, kingdom, war, text, out) {
        HoldingSieges._sendHome(world, kingdom, war, s);
        RealmWars._captureHolding(player, world, kingdom, war, { q: s.q, r: s.r });
        HoldingSieges._end(player, world, s, 'fallen', text, out);
    },

    _end(player, world, s, outcome, text, out) {
        const C = HoldingSieges.config();
        const st = HoldingSieges.state(player);
        if (!st.besieged[s.key]) return null;
        delete st.besieged[s.key];
        if (st.siegeStats[outcome] != null) st.siegeStats[outcome]++;
        const days = _day(world) - s.startDay;
        const settlement = HoldingSieges._settlement(world, s);
        // The garrison's losses fall on the stationed troops
        if (outcome !== 'fallen' && settlement && settlement.holding && s.garrisonStart > 0) {
            const share = Utils.clamp(1 - s.garrison / s.garrisonStart, 0, 1);
            if (share > 0) Holdings._garrisonLosses(settlement.holding, share);
            Holdings.refresh(settlement);
        }
        if (settlement && (outcome === 'relieved' || outcome === 'held')) {
            const O = C.outcome;
            const loyalty = outcome === 'relieved' ? O.relievedLoyalty : O.heldLoyalty;
            if (settlement.colony && typeof settlement.colony.loyalty === 'number') settlement.colony.loyalty = Math.min(100, settlement.colony.loyalty + loyalty);
            if (outcome === 'relieved') settlement.happiness = Utils.clamp(_num(settlement.happiness, 50) + O.relievedHappiness, 0, 100);
        }
        st.siegeHistory.push({ name: s.name, kingdomName: s.kingdomName, outcome, days, day: _day(world), assaults: s.assaults });
        if (st.siegeHistory.length > C.historyCap) st.siegeHistory.shift();
        if (player.house && outcome !== 'lifted') {
            House._chronicle(player.house, world, `After ${days} day(s) of siege: ${text}`, ['war', 'siege']);
        }
        const res = { outcome, text, days, name: s.name, q: s.q, r: s.r };
        if (out) {
            out.ended.push(res);
            const title = { relieved: '🎺 Siege Relieved', held: '🛡️ The Holding Held', terms: '🤝 Siege Lifted', bought: '💰 Siege Bought Off', fallen: '🏴 Holding Fallen', lifted: '🏳️ Siege Over' }[outcome];
            out.notices.push({ title, text, type: outcome === 'fallen' ? 'error' : 'success' });
        }
        return res;
    },

    _log(s, world, text) {
        s.log.push({ day: _day(world), text });
        if (s.log.length > HoldingSieges.config().logCap) s.log.shift();
    },
};
