// ============================================
// SIEGES — taking a settlement as an operation, not a single roll
// ============================================
// The player's army *invests* a settlement and camps before its walls. From
// then on every day counts, for both sides:
//
//   DEFENDERS  a garrison (population, the realm's army, a holding's troops),
//              walls (town type, a holding's walls, the realm's own defensive
//              character) with an integrity that engines and mines wear down,
//              food stores (settlement size, the season, its granaries) and
//              morale. Stores fall daily — fast under a tight cordon, slowly
//              at a port the sea still feeds, unless your galleys or an enemy
//              fleet blockade it (world/kingdomNavy.js). Empty stores starve
//              the garrison; hunger and low stores breed disease in the town.
//   THE CAMP   the army forages the land (by season, wearing it out) and eats
//              from the player's packs; hunger, camp disease (the flux, via
//              systems/ailments.js), boredom and desertion wear it down.
//              Army upkeep is still paid every day as usual.
//   STANCE     blockade (tighten the cordon), works (build a ram, a siege
//              tower or a trebuchet — technology gates the latter two) or sap
//              (dig a mine that brings down part of the wall).
//   ACTIONS    storm (a battle through PlayerMilitary.combat against the
//              garrison behind what is left of its walls; costly), negotiate
//              terms (surrender with safe passage, a ransom, or tribute —
//              traits, diplomacy and the court reputation weigh in), fight a
//              relief host, or lift the siege.
//   RELIEF     the owning realm may send a relief host out of its army: a
//              real world unit ('relief_host', saved with world.units) that
//              marches from the realm's capital and can be intercepted on the
//              road. Arrived, it attacks the camp the next day unless the
//              player fights it first or withdraws.
//   OUTCOMES   capture through PlayerMilitary.conquerSettlement (the liege
//              gets it, or it becomes the player's own holding), a sack
//              (plunder, karma, cruel deeds), or terms. A loyalist town of the
//              realm the player fights a civil war for (systems/throne.js)
//              declares for the pretender instead of being conquered.
//
// State lives on player.sieges and is saved with the player. Randomness flows
// through Utils only, and the daily tick draws nothing unless a siege is in
// progress. Tuning: data/military.json → sieges.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Economy } from '../world/economy.js';
import { Seasons } from '../world/seasons.js';
import { KingdomNavy } from '../world/kingdomNavy.js';
import { KingdomBonuses } from '../world/kingdomState.js';
import { Technology } from './technology.js';
import { Traits } from './traits.js';
import { House } from './house.js';
import { Quests } from './quests.js';
import { Holdings } from './holdings.js';
import { Ailments } from './ailments.js';
import { Petitions } from './petitions.js';
import { RealmWars } from './realmWars.js';
import { Kingship } from './kingship.js';
import { Gossip } from './gossip.js';
import { PlayerMilitary } from '../player/playerMilitary.js';
import { WorldUnit } from '../world/units.js';

const STANCES = ['blockade', 'works', 'sap'];
const TERMS = ['surrender', 'ransom', 'tribute'];
const FOOD_FALLBACK = ['bread', 'grain', 'food', 'cooked_meat', 'preserved_fish', 'fish', 'cooked_fish', 'fruit', 'berries', 'game_meat'];
const BARREN = /desert|tundra|snow|ice|glacier|mountain|wasteland/;

const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const _day = (world) => (world && world.day) || 0;

/** Built-in tuning; data/military.json → sieges overrides it key by key. */
const DEFAULTS = {
    minStrength: 50,
    leash: 1,              // hexes the army may stray from the walls (to meet a relief host) before the siege is lifted
    investReputation: -15,
    investKarma: -2,
    investFeud: 5,
    garrison: { popShare: 0.03, typeMult: { village: 0.8, town: 1.5, city: 3.0, capital: 5.0 }, militaryShare: { capital: 0.4, other: 0.15 } },
    walls: { village: 0, town: 0.1, city: 0.3, capital: 0.4, repairPerDay: 2, repairMorale: 50 },
    stores: {
        baseDays: { village: 10, town: 16, city: 22, capital: 30 },
        season: { Spring: 0.75, Summer: 1.0, Autumn: 1.3, Winter: 0.9 },
        lean: 0.7, reserveCap: 20, blockadeEats: 1.25, unblockadedPort: 0.5,
    },
    defenderMorale: { start: 70, capitalBonus: 10, reliefBonus: 10, daily: 1, blockadeDaily: 1, starving: 6, sick: 2, repelled: 8, refused: 3, reliefBeaten: 25 },
    townDisease: { lowStores: 0.25, lowChance: 0.05, starvingChance: 0.12, garrisonLoss: 0.02, popLoss: 0.005 },
    starvingGarrisonLoss: 0.03,
    camp: {
        moraleStart: 60, moralePerLeadership: 3, boredomAfter: 10, boredom: 1,
        hunger: 10, sickMorale: 3, workBuilt: 6, stormLost: 15, reliefWon: 15,
        rationsPerUnits: 3,
        forage: { Spring: 0.15, Summer: 0.3, Autumn: 0.35, Winter: 0.05 },
        forageExhaustDays: 25, forageFloor: 0.15, barrenTerrain: 0.4,
        desertBelow: 30, desertDivisor: 60, hungryDesertDays: 3,
    },
    campDisease: { perDay: 0.004, maxChance: 0.08, summer: 1.5, hungry: 1.5, townSick: 1.5, days: [5, 9], unitLossChance: 0.35, commanderChance: 0.35, ailment: 'flux' },
    works: {
        ram: { name: 'Battering ram', icon: '🐏', days: 3, cost: 60, tech: null, effect: 'Breaks the gate: the defence is 15% weaker when you storm.' },
        tower: { name: 'Siege tower', icon: '🗼', days: 6, cost: 150, tech: 'fortification', effect: 'Carries men over the walls: walls count half when you storm.' },
        trebuchet: { name: 'Trebuchet', icon: '🏹', days: 8, cost: 300, tech: 'siege_engineering', effect: 'Batters the walls every day (-6 integrity a day).' },
    },
    ramDefense: 0.85,
    towerWalls: 0.5,
    trebuchetDamage: 6,
    engineerSpeed: 1.5,
    largeArmy: 6,
    largeArmySpeed: 1.2,
    sap: { days: 10, fortificationSpeed: 1.5, counterChance: 0.06, counterSetback: 3, breach: 60 },
    storm: { apCost: 8, extraLoss: 0.12, starvingDefense: 0.8, sickDefense: 0.85, moraleFloor: 0.55, garrisonLoss: 0.1, failReputation: -10 },
    terms: {
        apCost: 2, cooldown: 3,
        surrender: { base: -0.25 }, ransom: { base: 0.05, perPop: 1.2 }, tribute: { base: 0, upfront: 0.3, weekly: 0.2, weeks: 4 },
        moraleWeight: 0.45, starving: 0.2, ratioWeight: 0.1, reliefPenalty: 0.15,
        diplomacy: 0.02, mercy: 0.01, severity: 0.005, intimidation: 0.03, min: 0.02, max: 0.95,
        surrenderPopKeep: 0.95, surrenderPlunder: [0.3, 0.8], surrenderKarma: -3, surrenderReputation: 0.5,
    },
    sack: { plunder: [3, 6], popKeep: 0.75, happiness: -20, karma: -15, reputation: -40, otherReputation: -10, feud: 20, severity: 3 },
    relief: {
        chance: { village: 0.4, town: 0.7, city: 0.8, capital: 1.0 },
        minMilitary: 60, share: 0.35, min: 30, max: 300,
        hexesPerDay: 3, extraDays: [2, 5], minDays: 3, maxDays: 20,
        sally: 0.25, sallyMorale: 40, returnShare: 0.8, stuckDays: 8,
    },
    civilWar: { momentum: 15, capitalMomentum: 40 },
};

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

export const Sieges = {
    STANCES,
    TERMS,
    DEFAULTS,

    /** Tuning: the defaults with data/military.json → sieges laid over them. */
    config() {
        const src = DataLoader.military && DataLoader.military.sieges;
        if (!_cfgCache || _cfgSource !== src) {
            _cfgCache = _merge(DEFAULTS, src || {});
            _cfgSource = src;
        }
        return _cfgCache;
    },

    _blank() {
        return { active: null, tributes: [], history: [], stats: { invested: 0, captured: 0, sacked: 0, terms: 0, lifted: 0, broken: 0, reliefsBeaten: 0 } };
    },

    /** player.sieges, created on demand. */
    state(player) {
        if (!player.sieges || typeof player.sieges !== 'object') player.sieges = Sieges._blank();
        const st = player.sieges;
        const blank = Sieges._blank();
        if (st.active === undefined) st.active = null;
        if (!Array.isArray(st.tributes)) st.tributes = [];
        if (!Array.isArray(st.history)) st.history = [];
        st.stats = { ...blank.stats, ...(st.stats || {}) };
        return st;
    },

    /** The siege in progress, or null. */
    active(player) {
        return (player && player.sieges && player.sieges.active) || null;
    },

    /** The siege in progress at (q, r), or null. */
    activeAt(player, q, r) {
        const s = Sieges.active(player);
        return s && s.q === q && s.r === r ? s : null;
    },

    serialize(player) {
        return player && player.sieges ? JSON.parse(JSON.stringify(player.sieges)) : null;
    },

    /** Backfill after a load: older saves have no siege record. */
    loadState(player) {
        if (!player) return;
        if (!player.sieges) { player.sieges = Sieges._blank(); return; }
        const st = Sieges.state(player);
        const s = st.active;
        if (s) {
            s.works = { ram: false, tower: false, trebuchet: false, ...(s.works || {}) };
            s.log = Array.isArray(s.log) ? s.log : [];
            if (!STANCES.includes(s.stance)) s.stance = 'blockade';
            for (const k of ['garrison', 'garrisonStart', 'walls', 'wallHp', 'stores', 'storesStart', 'morale', 'campMorale', 'mine', 'campSick', 'hungryDays', 'assaults', 'nextParleyDay']) {
                s[k] = _num(s[k]);
            }
            // A relief host recorded before it walked the map gets its unit on the next tick
            if (s.relief) {
                s.relief.strength = _num(s.relief.strength);
                s.relief.stuckDays = _num(s.relief.stuckDays);
            }
        }
    },

    // ── Reading a siege ─────────────────────────────────────────

    _tile(world, s) {
        return world && world.getTile ? world.getTile(s.q, s.r) : null;
    },

    _kingdom(world, id) {
        return id && world && world.getKingdom ? world.getKingdom(id) : null;
    },

    /** Land units (galleys don't man siege lines). */
    _landUnits(player) {
        return (player.army || []).filter(u => !PlayerMilitary.isNavalUnit(u));
    },

    /** The civil war (systems/throne.js) this settlement is a loyalist town of, or null. */
    _civilWar(player, settlement, q, r) {
        const cw = player.throne && player.throne.civilWar;
        if (!cw || !settlement || settlement.kingdom !== cw.kingdomId) return null;
        return cw;
    },

    /** Garrison troops of a settlement before the walls (cf. PlayerMilitary.getSettlementDefense). */
    garrisonOf(settlement, world) {
        const G = Sieges.config().garrison;
        let g = Math.floor(_num(settlement.population) * G.popShare * (G.typeMult[settlement.type] || 1));
        const k = Sieges._kingdom(world, settlement.kingdom);
        if (k && k.military > 0) g += Math.floor(k.military * (settlement.type === 'capital' ? G.militaryShare.capital : G.militaryShare.other));
        if (settlement.holding) g += Math.round(Holdings.garrisonStrength(settlement.holding) + _num(settlement.holding.fx && settlement.holding.fx.militia));
        return Math.max(1, g);
    },

    /** The walls' worth as a defence multiplier bonus (0 = no walls). */
    wallsOf(settlement, world) {
        const W = Sieges.config().walls;
        const k = Sieges._kingdom(world, settlement.kingdom);
        const realm = k ? Math.max(0, KingdomBonuses.get(k, 'defense')) : 0;
        return Math.max(0, _num(W[settlement.type]) + Economy.holdingFx(settlement, 'defense') + realm);
    },

    /** Days of food a besieged settlement starts with (size, season, granaries). */
    storesOf(settlement, world) {
        const S = Sieges.config().stores;
        const day = _day(world);
        let days = _num(S.baseDays[settlement.type]) || 12;
        days *= _num(S.season[Seasons.seasonOf(day)]) || 1;
        if (Seasons.isLean(day)) days *= S.lean;
        const reserve = Economy.foodReserveDays(settlement);
        if (Number.isFinite(reserve)) days += Math.min(S.reserveCap, reserve);
        return Math.round(days * 10) / 10;
    },

    /** Is the harbour shut: the player's galleys, or an enemy fleet blockading the realm. */
    navalBlockade(player, world, s) {
        if (!s.port) return false;
        if (PlayerMilitary.getNavalStrength(player) > 0) return true;
        return !!KingdomNavy.portBlockade(world, s.q, s.r);
    },

    /** Days of stores eaten today. */
    consumption(player, world, s) {
        const S = Sieges.config().stores;
        let c = 1;
        if (s.stance === 'blockade') c *= S.blockadeEats;
        if (s.port && !Sieges.navalBlockade(player, world, s)) c *= S.unblockadedPort;
        return c;
    },

    /** What the walls are worth today after engines and mines. */
    effectiveWalls(s) {
        const C = Sieges.config();
        return s.walls * Utils.clamp(s.wallHp, 0, 100) / 100 * (s.works.tower ? C.towerWalls : 1);
    },

    /** Strength the garrison fights a storm with. */
    stormDefense(s) {
        const C = Sieges.config();
        const T = C.storm;
        let d = s.garrison * (1 + Sieges.effectiveWalls(s));
        if (s.works.ram) d *= C.ramDefense;
        d *= T.moraleFloor + (1 - T.moraleFloor) * Utils.clamp(s.morale, 0, 100) / 100;
        if (s.stores <= 0) d *= T.starvingDefense;
        if (s.townSick) d *= T.sickDefense;
        return Math.max(1, Math.round(d));
    },

    /** Food the camp needs a day, and what the land gives it today. */
    supply(player, world, s) {
        const C = Sieges.config().camp;
        const units = Sieges._landUnits(player).length;
        const need = Math.ceil(units / C.rationsPerUnits);
        const tile = Sieges._tile(world, s);
        const terrain = (tile && tile.terrain && tile.terrain.id) || '';
        const days = _day(world) - s.startDay;
        const exhaust = Math.max(C.forageFloor, 1 - days / C.forageExhaustDays);
        const rate = _num(C.forage[Seasons.seasonOf(_day(world))]) * (BARREN.test(terrain) ? C.barrenTerrain : 1) * exhaust;
        const forage = Math.min(need, Math.floor(units * rate));
        return { units, need, forage, packs: Sieges._foodInPacks(player) };
    },

    _foodTypes(player) {
        return (player && player.constructor && player.constructor.FOOD_TYPES) || FOOD_FALLBACK;
    },

    _foodInPacks(player) {
        let n = 0;
        for (const id of Sieges._foodTypes(player)) n += _num(player.inventory && player.inventory[id]);
        return n;
    },

    /** Eat up to n food from the packs (plainest first). Returns what was eaten. */
    _eatFromPacks(player, n) {
        let left = n;
        const inv = player.inventory || {};
        for (const id of Sieges._foodTypes(player)) {
            if (left <= 0) break;
            const have = _num(inv[id]);
            if (have <= 0) continue;
            const take = Math.min(have, left);
            inv[id] = have - take;
            if (inv[id] <= 0) delete inv[id];
            left -= take;
        }
        return n - left;
    },

    /** Gold the town offers for each kind of terms. */
    termsValue(s) {
        const T = Sieges.config().terms;
        const ransom = Math.max(50, Math.round(s.population * T.ransom.perPop * (1.3 - Utils.clamp(s.morale, 0, 100) / 100 * 0.6)));
        return {
            ransom,
            tributeUpfront: Math.round(ransom * T.tribute.upfront),
            tributeWeekly: Math.round(ransom * T.tribute.weekly),
            tributeWeeks: T.tribute.weeks,
        };
    },

    /** Chance the defenders accept these terms today (0–1). */
    termsChance(player, world, term) {
        const s = Sieges.active(player);
        const T = Sieges.config().terms;
        if (!s || !TERMS.includes(term)) return 0;
        let p = _num(T[term] && T[term].base);
        p += (1 - Utils.clamp(s.morale, 0, 100) / 100) * T.moraleWeight;
        if (s.stores <= 0) p += T.starving;
        const ratio = PlayerMilitary.getArmyStrength(player) / Math.max(1, Sieges.stormDefense(s));
        p += Utils.clamp((ratio - 1) * T.ratioWeight, -0.2, 0.25);
        if (s.relief && !s.relief.arrived) p -= T.reliefPenalty;
        p += _num(player.skills && player.skills.diplomacy) * T.diplomacy;
        p += Traits.effect(player, 'negotiation');
        p -= Traits.effect(player, 'intimidation') * T.intimidation; // a feared name opens gates
        const court = (player.petitions && player.petitions.court) || {};
        p += _num(court.mercy) * T.mercy + _num(court.severity) * T.severity;
        return Utils.clamp(p, T.min, T.max);
    },

    /** A summary for the siege panel. */
    describe(player, world) {
        const s = Sieges.active(player);
        if (!s) return null;
        const sup = Sieges.supply(player, world, s);
        const eat = Sieges.consumption(player, world, s);
        const daily = Math.max(0, sup.need - sup.forage);
        return {
            siege: s,
            day: _day(world) - s.startDay,
            defense: Sieges.stormDefense(s),
            army: PlayerMilitary.getArmyStrength(player),
            effectiveWalls: Sieges.effectiveWalls(s),
            storesDaysLeft: eat > 0 ? Math.max(0, Math.floor(s.stores / eat)) : null,
            eatsPerDay: eat,
            navalBlockade: Sieges.navalBlockade(player, world, s),
            supply: sup,
            campDaysLeft: daily > 0 ? Math.floor(sup.packs / daily) : null,
            reliefEta: s.relief && !s.relief.arrived ? Sieges.reliefEta(world, s) : null,
            // Within a hex of your lines: you may march out and meet it on the road
            reliefNear: !!(s.relief && typeof s.relief.q === 'number' && typeof player.q === 'number'
                && Hex.wrappingDistance(player.q, player.r, s.relief.q, s.relief.r, world.width) <= 1),
            terms: Sieges.termsValue(s),
            chances: Object.fromEntries(TERMS.map(t => [t, Sieges.termsChance(player, world, t)])),
            canParley: _day(world) >= s.nextParleyDay,
            works: Sieges.workOptions(player, s),
        };
    },

    /** Days until the relief host reaches the walls (mustering, then the march from where it is now). */
    reliefEta(world, s) {
        const rel = s && s.relief;
        if (!rel || rel.arrived) return null;
        if (typeof rel.q !== 'number') return Math.max(0, _num(rel.arriveDay) - _day(world));
        const dist = Hex.wrappingDistance(rel.q, rel.r, s.q, s.r, world.width);
        return Math.max(0, _num(rel.departDay) - _day(world)) + Math.ceil(dist / Sieges.config().relief.hexesPerDay);
    },

    /** Engines the player can build here: [{ id, name, built, building, progress, days, cost, can, reason }]. */
    workOptions(player, s) {
        const W = Sieges.config().works;
        return Object.entries(W).map(([id, def]) => {
            const built = !!(s && s.works && s.works[id]);
            const building = !!(s && s.building && s.building.id === id);
            let can = !built;
            let reason = built ? 'Built' : '';
            if (can && def.tech && !Technology.hasResearched(player, def.tech)) { can = false; reason = `Needs ${def.tech.replace(/_/g, ' ')}`; }
            if (can && !building && s && s.building) { can = false; reason = 'Another engine is being built'; }
            if (can && !building && _num(player.gold) < def.cost) { can = false; reason = `Needs ${def.cost} gold`; }
            return { id, ...def, built, building, progress: building ? s.building.progress : 0, can, reason };
        });
    },

    // ── Starting a siege ────────────────────────────────────────

    canInvest(player, world, tile) {
        const C = Sieges.config();
        const settlement = tile && tile.settlement;
        if (!settlement) return { ok: false, reason: 'There is no settlement here.' };
        if (Sieges.active(player)) return { ok: false, reason: `You are already besieging ${Sieges.active(player).name}.` };
        if (settlement.colony && settlement.colony.isPlayerColony) return { ok: false, reason: 'This is your own holding.' };
        // A seat of lords in revolt against your own crown may be besieged (systems/kingship.js)
        const rebelSeat = Kingship.isRebelSeat(player, tile.q, tile.r);
        if (player.allegiance && settlement.kingdom === player.allegiance && !rebelSeat) return { ok: false, reason: 'This town belongs to your liege.' };
        const cw = Sieges._civilWar(player, settlement, tile.q, tile.r);
        if (cw && cw.sides && cw.sides[`${tile.q},${tile.r}`] === 'pretender') return { ok: false, reason: `${settlement.name} has declared for you.` };
        if (player.boardedShip) return { ok: false, reason: 'Go ashore first.' };
        if (PlayerMilitary.getArmyStrength(player) === 0) return { ok: false, reason: 'You have no land army! Recruit soldiers first — galleys alone cannot take a town.' };
        if (PlayerMilitary.getArmyStrength(player) < C.minStrength) return { ok: false, reason: `Army too weak to besiege a settlement (need ${C.minStrength}+ strength)` };
        return { ok: true };
    },

    /** Camp before the walls: the siege begins. */
    invest(player, world, tile) {
        const check = Sieges.canInvest(player, world, tile);
        if (!check.ok) return { success: false, reason: check.reason };
        const C = Sieges.config();
        const st = Sieges.state(player);
        const settlement = tile.settlement;
        const day = _day(world);
        const kingdom = Sieges._kingdom(world, settlement.kingdom);
        const cw = Sieges._civilWar(player, settlement, tile.q, tile.r);
        const stores = Sieges.storesOf(settlement, world);
        const lead = _num(player.skills && player.skills.leadership);
        const s = {
            q: tile.q, r: tile.r,
            name: settlement.name, type: settlement.type || 'village',
            kingdomId: settlement.kingdom || null,
            kingdomName: kingdom ? kingdom.name : null,
            civilWar: !!cw,
            revolt: Kingship.isRebelSeat(player, tile.q, tile.r),
            population: _num(settlement.population),
            startDay: day,
            stance: 'blockade',
            garrison: Sieges.garrisonOf(settlement, world),
            walls: Math.round(Sieges.wallsOf(settlement, world) * 100) / 100,
            wallHp: 100,
            stores, storesStart: stores,
            morale: Utils.clamp(C.defenderMorale.start + (settlement.type === 'capital' ? C.defenderMorale.capitalBonus : 0), 0, 100),
            townSick: false,
            port: KingdomNavy.isPortTile(world, tile.q, tile.r),
            campMorale: Utils.clamp(C.camp.moraleStart + lead * C.camp.moralePerLeadership, 0, 100),
            campSick: 0,
            hungryDays: 0,
            works: { ram: false, tower: false, trebuchet: false },
            building: null,
            mine: 0,
            assaults: 0,
            nextParleyDay: day,
            relief: null,
            log: [],
        };
        // Rebels hold their own walls: their men, not the crown's army
        if (s.revolt) s.garrison = Math.max(1, Math.round(Kingship.rebelStrength(player) * _num((Kingship.config().revolt || {}).garrisonShare) + s.population * 0.02));
        s.garrisonStart = s.garrison;
        st.active = s;
        st.stats.invested++;

        // Will the realm march to relieve it? (Not your own realm against its rebels.)
        if (kingdom && kingdom.isAlive !== false && !s.revolt) {
            const R = C.relief;
            const chance = _num(R.chance[s.type]);
            const from = (kingdom.military || 0) >= R.minMilitary ? Sieges._reliefOrigin(world, kingdom, s) : null;
            if (from && Utils.random() < chance) {
                const strength = Utils.clamp(Math.round(kingdom.military * R.share), R.min, R.max);
                const dist = Hex.wrappingDistance(from.q, from.r, s.q, s.r, world.width);
                const days = Utils.clamp(Math.ceil(dist / R.hexesPerDay) + Utils.randInt(R.extraDays[0], R.extraDays[1]), R.minDays, R.maxDays);
                kingdom.military = Math.max(0, kingdom.military - strength);
                s.relief = {
                    id: `rh_${kingdom.id}_${day}_${s.q}_${s.r}`,
                    name: `${kingdom.name} Relief Host`, kingdomId: kingdom.id, strength,
                    q: from.q, r: from.r, stuckDays: 0,
                    departDay: day + Math.max(0, days - Math.ceil(dist / R.hexesPerDay)), // mustering
                    arriveDay: day + days, arrived: false, arrivedDay: null,
                };
                Sieges._spawnRelief(world, s);
                s.morale = Utils.clamp(s.morale + C.defenderMorale.reliefBonus, 0, 100);
            }
        }

        // Acts of war against the owner (a civil war or a revolt is already one)
        if (s.kingdomId && !s.civilWar && !s.revolt) {
            if (!player.reputation) player.reputation = {};
            player.reputation[s.kingdomId] = (player.reputation[s.kingdomId] || 0) + C.investReputation;
            House.accrueRivalFeud(player, world, s.kingdomId, C.investFeud, `besieged ${s.name}`);
            // Besieging a realm's town is war with that realm — unless you fight
            // it as your liege's sworn man in a war the crowns already wage
            const liege = player.allegiance && world.getKingdom ? world.getKingdom(player.allegiance) : null;
            const liegesWar = !!(liege && Array.isArray(liege.wars) && liege.wars.includes(s.kingdomId));
            if (kingdom && kingdom.isAlive !== false && !liegesWar && !RealmWars.atWarWith(player, s.kingdomId)) {
                RealmWars.declareWar(player, world, kingdom, 'siege');
                s.declaredWar = true;
            }
        }
        player.karma = _num(player.karma) + C.investKarma;
        Traits.recordAggression(player, s.kingdomId, { dread: 1 });
        Sieges._log(s, world, `The army invests ${s.name}: ${s.garrison} defenders, ${Math.round(s.stores)} days of food.`);
        if (world.events) world.events.push({ text: `🏰 ${player.name || 'A lord'} lays siege to ${s.name}!`, type: 'military' });
        return { success: true, siege: s };
    },

    // ── The relief host on the map ──────────────────────────────

    /** Where a realm's relief host musters: its capital, or (the capital besieged) its nearest other town. */
    _reliefOrigin(world, kingdom, s) {
        if (kingdom.capital && !(kingdom.capital.q === s.q && kingdom.capital.r === s.r)) return { q: kingdom.capital.q, r: kingdom.capital.r };
        if (!world.getAllSettlements) return null;
        let best = null;
        for (const t of world.getAllSettlements()) {
            if (t.kingdom !== kingdom.id || (t.q === s.q && t.r === s.r)) continue;
            const d = Hex.wrappingDistance(t.q, t.r, s.q, s.r, world.width);
            if (!best || d < best.d) best = { d, q: t.q, r: t.r };
        }
        return best ? { q: best.q, r: best.r } : null;
    },

    /** Put the relief host on the map as a world unit (saved with world.units). */
    _spawnRelief(world, s) {
        const rel = s.relief;
        if (!world.units) world.units = [];
        const unit = new WorldUnit('relief_host', rel.q, rel.r, s.q, s.r);
        unit.id = rel.id;
        unit.icon = '🚩';
        unit.name = rel.name;
        unit.speed = Sieges.config().relief.hexesPerDay;
        unit.strength = rel.strength;
        unit.population = rel.strength * 2;
        unit.kingdomId = rel.kingdomId;
        unit.reliefFor = `${s.q},${s.r}`;
        const marching = !(rel.departDay > _day(world));
        unit.objectiveQ = marching ? s.q : null;
        unit.objectiveR = marching ? s.r : null;
        unit.maxAge = 100000;
        unit.inventory = { gold: Math.round(rel.strength * 2), food: rel.strength };
        world.units.push(unit);
        return unit;
    },

    /** The relief host's unit: null when it has been destroyed (by the player). */
    _reliefUnit(world, s) {
        const rel = s.relief;
        if (!rel) return null;
        const unit = (world.units || []).find(u => u.id === rel.id);
        return unit && !unit.destroyed ? unit : null;
    },

    /** The relief host goes home: its unit leaves the map, most of its men rejoin the realm's army. */
    _reliefHome(world, s) {
        const rel = s.relief;
        if (!rel) return;
        const unit = (world.units || []).find(u => u.id === rel.id);
        if (unit) unit.destroyed = true;
        const k = Sieges._kingdom(world, rel.kingdomId);
        if (k) k.military = _num(k.military) + Math.round(rel.strength * Sieges.config().relief.returnShare);
    },

    /** Shortest land route from `from` to `to` (breadth-first over passable tiles), or null. Draws nothing. */
    _landPath(world, from, to, maxNodes = 4000) {
        const key = (q, r) => `${q},${r}`;
        const goal = key(to.q, to.r);
        const prev = new Map([[key(from.q, from.r), null]]);
        const queue = [{ q: from.q, r: from.r }];
        for (let i = 0; i < queue.length && prev.size < maxNodes; i++) {
            const cur = queue[i];
            for (const n of Hex.neighbors(cur.q, cur.r)) {
                const q = Hex.wrapQ(n.q, world.width);
                const k = key(q, n.r);
                if (prev.has(k)) continue;
                const t = world.getTile(q, n.r);
                if (!t || !t.terrain || !t.terrain.passable) continue;
                prev.set(k, key(cur.q, cur.r));
                if (k === goal) {
                    const path = [];
                    for (let at = k; at && at !== key(from.q, from.r); at = prev.get(at)) {
                        const [pq, pr] = at.split(',').map(Number);
                        path.unshift({ q: pq, r: pr });
                    }
                    return path;
                }
                queue.push({ q, r: n.r });
            }
        }
        return null;
    },

    /** The relief host's march today: legacy records get a unit, a destroyed unit means it was broken. */
    _reliefDay(player, world, s, out) {
        const rel = s.relief;
        const C = Sieges.config();
        const day = _day(world);
        if (!rel.id) {
            // A save from before relief hosts walked the map
            rel.id = `rh_${rel.kingdomId}_${s.startDay}_${s.q}_${s.r}`;
            const k = Sieges._kingdom(world, rel.kingdomId);
            const from = rel.arrived ? { q: s.q, r: s.r } : (k && Sieges._reliefOrigin(world, k, s)) || { q: s.q, r: s.r };
            rel.q = from.q; rel.r = from.r; rel.stuckDays = 0; rel.departDay = 0;
            Sieges._spawnRelief(world, s);
            return null;
        }
        const unit = Sieges._reliefUnit(world, s);
        if (!unit) {
            // Cut down on the road (or at the walls) by your army
            s.relief = null;
            s.morale = Utils.clamp(s.morale - C.defenderMorale.reliefBeaten, 0, 100);
            s.campMorale = Utils.clamp(s.campMorale + C.camp.reliefWon, 0, 100);
            Sieges.state(player).stats.reliefsBeaten++;
            const text = `${rel.name} is no more. ${s.name} is alone.`;
            Sieges._log(s, world, text);
            out.notices.push({ title: '🚩 Relief Broken', text, type: 'success' });
            return null;
        }
        if (unit.objectiveQ == null && day >= _num(rel.departDay)) {
            unit.objectiveQ = s.q;
            unit.objectiveR = s.r;
        }
        let moved = unit.q !== rel.q || unit.r !== rel.r;
        if (!moved && !rel.arrived && unit.objectiveQ != null && !(unit.q === s.q && unit.r === s.r)) {
            // The straight march is blocked (water, mountains): take the long road round
            const path = Sieges._landPath(world, unit, s);
            if (path && path.length) {
                const step = path[Math.min(path.length, Math.max(1, _num(unit.speed, 1))) - 1];
                unit.q = step.q; unit.r = step.r;
                moved = true;
            }
        }
        rel.q = unit.q; rel.r = unit.r;
        if (rel.arrived) return unit;
        if (unit.q === s.q && unit.r === s.r) return unit;
        rel.stuckDays = (!moved && unit.objectiveQ != null) ? _num(rel.stuckDays) + 1 : 0;
        if (rel.stuckDays >= C.relief.stuckDays) {
            const text = `${rel.name} can find no road to ${s.name} and turns back.`;
            Sieges._reliefHome(world, s);
            s.relief = null;
            Sieges._log(s, world, text);
            out.notices.push({ title: '🚩 Relief Turns Back', text, type: 'success' });
            return null;
        }
        return unit;
    },

    // ── Daily choices ───────────────────────────────────────────

    /** Choose the camp's work: 'blockade', 'works' (with an engine id) or 'sap'. */
    setStance(player, world, stance, workId = null) {
        const s = Sieges.active(player);
        if (!s) return { success: false, reason: 'No siege in progress.' };
        if (!STANCES.includes(stance)) return { success: false, reason: 'Unknown stance.' };
        if (stance === 'works') {
            const id = workId || (s.building && s.building.id);
            const opt = Sieges.workOptions(player, s).find(o => o.id === id);
            if (!opt) return { success: false, reason: 'Choose an engine to build.' };
            if (!opt.can) return { success: false, reason: opt.reason || 'Cannot build that.' };
            if (!opt.building) {
                player.gold -= opt.cost;
                s.building = { id, progress: 0 };
                Sieges._log(s, world, `Carpenters start on a ${opt.name.toLowerCase()} (${opt.cost} gold).`);
            }
        }
        s.stance = stance;
        return { success: true, stance };
    },

    /** Storm the walls. opts.sack: loot the town and leave instead of holding it. */
    storm(player, world, opts = {}) {
        const s = Sieges.active(player);
        if (!s) return { success: false, reason: 'No siege in progress.' };
        const C = Sieges.config();
        const tile = Sieges._tile(world, s);
        const settlement = tile && tile.settlement;
        if (!settlement) return Sieges._finish(player, world, 'lifted', 'The town is gone.');
        const defense = Sieges.stormDefense(s);
        const landBefore = Sieges._landUnits(player).length;
        const theatre = PlayerMilitary.settlementTheatre(world, tile);
        const result = PlayerMilitary.combat(player, defense, settlement.name, {
            terrainId: tile.terrain && tile.terrain.id,
            enemyComposition: PlayerMilitary._getSettlementComposition(settlement, tile),
            world, siege: true, theatre,
            enemyMoraleBonus: settlement.type === 'capital' ? 0.1 : 0,
        });
        if (result.reason) return { success: false, reason: result.reason };
        result.success = true;
        result.defense = defense;
        s.assaults++;

        // Scaling the walls costs men even in victory
        const extra = Math.round(landBefore * C.storm.extraLoss * Utils.clamp(s.wallHp, 0, 100) / 100 * (s.works.tower ? C.towerWalls : 1));
        result.stormLosses = Sieges._loseUnits(player, extra);

        if (result.victory) {
            result.outcome = opts.sack ? Sieges._sack(player, world, s, tile, result) : Sieges._take(player, world, s, tile, result, 'storm');
            return result;
        }
        s.garrison = Math.max(1, Math.round(s.garrison * (1 - C.storm.garrisonLoss)));
        s.morale = Utils.clamp(s.morale + C.defenderMorale.repelled, 0, 100);
        s.campMorale = Utils.clamp(s.campMorale - C.camp.stormLost, 0, 100);
        if (s.kingdomId && !s.civilWar && !s.revolt && player.reputation) {
            player.reputation[s.kingdomId] = (player.reputation[s.kingdomId] || 0) + C.storm.failReputation;
        }
        Sieges._log(s, world, `The assault on ${s.name} is thrown back from the walls.`);
        if (PlayerMilitary.getArmyStrength(player) <= 0) {
            result.outcome = Sieges._finish(player, world, 'broken', `The siege of ${s.name} collapses: no army is left to hold the lines.`);
        }
        return result;
    },

    /** Offer terms: 'surrender' (gates open, safe passage), 'ransom' (gold to leave) or 'tribute'. */
    negotiate(player, world, term) {
        const s = Sieges.active(player);
        if (!s) return { success: false, reason: 'No siege in progress.' };
        if (!TERMS.includes(term)) return { success: false, reason: 'Unknown terms.' };
        const T = Sieges.config().terms;
        const day = _day(world);
        if (day < s.nextParleyDay) return { success: false, reason: `The defenders will not parley again for ${s.nextParleyDay - day} day(s).` };
        const chance = Sieges.termsChance(player, world, term);
        s.nextParleyDay = day + T.cooldown;
        if (!(Utils.random() < chance)) {
            s.morale = Utils.clamp(s.morale + Sieges.config().defenderMorale.refused, 0, 100);
            Sieges._log(s, world, `${s.name} refuses your terms (${term}).`);
            return { success: true, accepted: false, chance, message: `The defenders of ${s.name} refuse your terms.` };
        }
        const tile = Sieges._tile(world, s);
        const out = { success: true, accepted: true, chance, term };
        if (term === 'surrender') {
            out.outcome = Sieges._take(player, world, s, tile, out, 'surrender');
            return out;
        }
        const v = Sieges.termsValue(s);
        const kingdom = Sieges._kingdom(world, s.kingdomId);
        const pay = (amount) => {
            if (kingdom && kingdom.treasury > 0) kingdom.treasury = Math.max(0, kingdom.treasury - amount);
            player.gold = _num(player.gold) + amount;
        };
        if (term === 'ransom') {
            pay(v.ransom);
            out.gold = v.ransom;
            Traits.recordDeeds(player, { greed: 1 });
            out.outcome = Sieges._finish(player, world, 'terms', `${s.name} pays a ransom of ${v.ransom} gold and your army marches away.`);
        } else {
            pay(v.tributeUpfront);
            out.gold = v.tributeUpfront;
            const st = Sieges.state(player);
            st.tributes.push({ name: s.name, q: s.q, r: s.r, kingdomId: s.kingdomId, amount: v.tributeWeekly, weeksLeft: v.tributeWeeks, nextDay: day + 7 });
            Traits.recordDeeds(player, { mercy: 1 });
            out.outcome = Sieges._finish(player, world, 'terms', `${s.name} pays ${v.tributeUpfront} gold now and swears ${v.tributeWeekly} gold a week for ${v.tributeWeeks} weeks.`);
        }
        Sieges._court(player, { mercy: 1 });
        return out;
    },

    /** March out to meet the relief host before it falls on the camp. */
    fightRelief(player, world) {
        const s = Sieges.active(player);
        if (!s || !s.relief) return { success: false, reason: 'No relief host to fight.' };
        // Arrived at the walls, or met on the road within reach of your lines
        const r = s.relief;
        const near = typeof r.q === 'number' && Hex.wrappingDistance(player.q, player.r, r.q, r.r, world.width) <= 1;
        if (!r.arrived && !near) return { success: false, reason: `${r.name} has not arrived yet.` };
        return Sieges._reliefBattle(player, world, s, true);
    },

    /** Break camp and march away. */
    lift(player, world) {
        const s = Sieges.active(player);
        if (!s) return { success: false, reason: 'No siege in progress.' };
        return Sieges._finish(player, world, 'lifted', `You lift the siege of ${s.name}.`);
    },

    // ── The daily tick ──────────────────────────────────────────

    /**
     * Advance tribute and the siege one day. Draws no randomness unless a
     * siege is in progress. Returns { notices: [{ title, text, type }], ended, battle }.
     */
    processDay(world, player) {
        const out = { notices: [], ended: null, battle: null };
        if (!player || !world || !player.sieges) return out;
        Sieges._tributeDay(player, world, out);
        const s = player.sieges.active;
        if (!s) return out;
        const C = Sieges.config();
        const day = _day(world);
        const tile = Sieges._tile(world, s);
        const settlement = tile && tile.settlement;

        // Is there still a siege to hold?
        let why = null;
        if (!settlement) why = `${s.name} is no more.`;
        else if ((settlement.kingdom || null) !== s.kingdomId || (settlement.colony && settlement.colony.isPlayerColony)) why = `${s.name} has changed hands.`;
        else if (s.civilWar && (player.throne && player.throne.civilWar && player.throne.civilWar.sides || {})[`${s.q},${s.r}`] === 'pretender') why = `${s.name} declares for you of its own accord.`;
        else if (s.revolt && !Kingship.isRebelSeat(player, s.q, s.r)) why = `${s.name} no longer holds out against the crown.`;
        else if (typeof player.q !== 'number' || Hex.wrappingDistance(player.q, player.r, s.q, s.r, world.width) > _num(C.leash)) why = `You marched away from ${s.name}; the siege is lifted.`;
        else if (player.jailState || player.indenturedServitude) why = `Without you the siege of ${s.name} breaks up.`;
        else if (PlayerMilitary.getArmyStrength(player) <= 0) why = `No army is left to hold the lines before ${s.name}.`;
        if (why) {
            out.ended = Sieges._finish(player, world, 'lifted', why);
            out.notices.push({ title: '🏳️ Siege Lifted', text: why, type: 'warning' });
            return out;
        }

        // The relief host, marching on the map
        if (s.relief) Sieges._reliefDay(player, world, s, out);
        if (s.relief) {
            const atWalls = s.relief.q === s.q && s.relief.r === s.r;
            if (s.relief.arrived && day > s.relief.arrivedDay) {
                out.notices.push({ title: '🚩 Relief Attacks', text: `${s.relief.name} falls on your siege lines!`, type: 'error' });
                out.battle = Sieges._reliefBattle(player, world, s, false);
                if (out.battle.message) out.notices.push({ title: out.battle.victory ? '🚩 Relief Broken' : '🚩 Siege Broken', text: out.battle.message, type: out.battle.victory ? 'success' : 'error' });
                if (out.battle.outcome) { out.ended = out.battle.outcome; return out; }
            } else if (!s.relief.arrived && atWalls) {
                s.relief.arrived = true;
                s.relief.arrivedDay = day;
                const text = `${s.relief.name} (strength ${s.relief.strength}) has come to relieve ${s.name}. Fight it or withdraw, or it attacks tomorrow.`;
                Sieges._log(s, world, text);
                out.notices.push({ title: '🚩 Relief Host Arrives', text, type: 'error' });
            }
        }

        Sieges._defendersDay(player, world, s, settlement, out);
        Sieges._worksDay(player, world, s, out);
        Sieges._campDay(player, world, s, tile, out);

        if (s.morale <= 0 || s.garrison <= 0) {
            const res = { victory: true };
            out.ended = Sieges._take(player, world, s, tile, res, 'surrender');
            out.notices.push({ title: '🏳️ The Gates Open', text: `Starving and broken, ${s.name} surrenders.`, type: 'success' });
            out.result = res;
            return out;
        }
        if (PlayerMilitary.getArmyStrength(player) <= 0) {
            out.ended = Sieges._finish(player, world, 'broken', `Your army melts away before ${s.name}.`);
            out.notices.push({ title: '🏳️ Siege Broken', text: out.ended.text, type: 'error' });
        }
        return out;
    },

    _defendersDay(player, world, s, settlement, out) {
        const C = Sieges.config();
        const M = C.defenderMorale;
        const D = C.townDisease;
        s.stores = Math.max(0, Math.round((s.stores - Sieges.consumption(player, world, s)) * 100) / 100);
        const starving = s.stores <= 0;
        let dm = -M.daily - (s.stance === 'blockade' ? M.blockadeDaily : 0);
        if (starving) {
            dm -= M.starving;
            s.garrison = Math.max(0, Math.floor(s.garrison * (1 - C.starvingGarrisonLoss)));
        }
        if (!s.townSick) {
            const low = s.stores <= s.storesStart * D.lowStores;
            const chance = starving ? D.starvingChance : low ? D.lowChance : 0;
            if (chance > 0 && Utils.random() < chance) {
                s.townSick = true;
                const text = `Sickness breaks out inside ${s.name}.`;
                Sieges._log(s, world, text);
                out.notices.push({ title: '🤒 Disease in the Town', text, type: 'info' });
            }
        }
        if (s.townSick) {
            dm -= M.sick;
            s.garrison = Math.max(0, Math.floor(s.garrison * (1 - D.garrisonLoss)));
            settlement.population = Math.max(1, Math.floor(_num(settlement.population) * (1 - D.popLoss)));
        }
        s.morale = Utils.clamp(Math.round((s.morale + dm) * 10) / 10, 0, 100);
        // Walls mended by night
        if (s.wallHp < 100 && !starving && s.morale >= C.walls.repairMorale) s.wallHp = Math.min(100, s.wallHp + C.walls.repairPerDay);
    },

    _worksDay(player, world, s, out) {
        const C = Sieges.config();
        const land = Sieges._landUnits(player);
        let speed = land.some(u => _num(u.siegeBonus) > 0) ? C.engineerSpeed : 1;
        if (land.length >= C.largeArmy) speed *= C.largeArmySpeed;
        if (s.stance === 'works' && s.building) {
            const def = C.works[s.building.id];
            s.building.progress = Math.round((s.building.progress + speed) * 10) / 10;
            if (def && s.building.progress >= def.days) {
                s.works[s.building.id] = true;
                s.building = null;
                s.stance = 'blockade';
                s.campMorale = Utils.clamp(s.campMorale + C.camp.workBuilt, 0, 100);
                const text = `Your ${def.name.toLowerCase()} stands ready before ${s.name}.`;
                Sieges._log(s, world, text);
                out.notices.push({ title: `${def.icon} Siege Works`, text, type: 'success' });
            }
        } else if (s.stance === 'sap') {
            const S = C.sap;
            if (Utils.random() < S.counterChance) {
                s.mine = Math.max(0, s.mine - S.counterSetback);
                const lost = Sieges._loseUnits(player, 1);
                const text = `The defenders break into your mine${lost ? ' and kill a sapper crew' : ''}.`;
                Sieges._log(s, world, text);
                out.notices.push({ title: '⛏️ Countermine', text, type: 'warning' });
            } else {
                s.mine = Math.round((s.mine + speed * (Technology.hasResearched(player, 'fortification') ? S.fortificationSpeed : 1)) * 10) / 10;
                if (s.mine >= S.days) {
                    s.mine = 0;
                    s.wallHp = Math.max(0, s.wallHp - S.breach);
                    const text = `Your mine is fired: a stretch of ${s.name}'s wall comes down (walls ${Math.round(s.wallHp)}%).`;
                    Sieges._log(s, world, text);
                    out.notices.push({ title: '💥 The Mine Is Fired', text, type: 'success' });
                }
            }
        }
        if (s.works.trebuchet && s.wallHp > 0) s.wallHp = Math.max(0, s.wallHp - C.trebuchetDamage);
    },

    _campDay(player, world, s, tile, out) {
        const C = Sieges.config();
        const K = C.camp;
        const day = _day(world);
        // Supply: the land first, then the packs
        const sup = Sieges.supply(player, world, s);
        const short = sup.need - sup.forage;
        const eaten = short > 0 ? Sieges._eatFromPacks(player, short) : 0;
        const hungry = short - eaten > 0;
        if (hungry) {
            s.hungryDays++;
            s.campMorale -= K.hunger;
            if (s.hungryDays === 1) out.notices.push({ title: '🍞 The Camp Goes Hungry', text: `Your soldiers before ${s.name} have nothing to eat. Bring food or lift the siege.`, type: 'warning' });
        } else {
            s.hungryDays = 0;
        }
        if (day - s.startDay > K.boredomAfter) s.campMorale -= K.boredom;

        // Camp disease
        const D = C.campDisease;
        if (s.campSick > 0) {
            s.campSick--;
            s.campMorale -= K.sickMorale;
            if (Utils.random() < D.unitLossChance && Sieges._loseUnits(player, 1)) {
                out.notices.push({ title: '🤒 Camp Fever', text: `The flux carries off a company before ${s.name}.`, type: 'warning' });
            }
        } else {
            let chance = Math.min(D.maxChance, D.perDay * (day - s.startDay));
            if (Seasons.seasonOf(day) === 'Summer') chance *= D.summer;
            if (hungry) chance *= D.hungry;
            if (s.townSick) chance *= D.townSick;
            chance *= 1 - Technology.getPlagueResistance(player);
            if (chance > 0 && Utils.random() < chance) {
                s.campSick = Utils.randInt(D.days[0], D.days[1]);
                let text = `Sickness spreads through your siege camp at ${s.name}.`;
                if (Utils.random() < D.commanderChance) {
                    const rep = Ailments.inflict(player, world, D.ailment, { source: 'siege camp' });
                    if (rep) text += ` You fall ill yourself: ${rep.name}.`;
                }
                Sieges._log(s, world, text);
                out.notices.push({ title: '🤒 Camp Disease', text, type: 'warning' });
            }
        }

        // Desertion
        s.campMorale = Utils.clamp(Math.round(s.campMorale), 0, 100);
        let desert = s.campMorale < K.desertBelow ? (K.desertBelow - s.campMorale) / K.desertDivisor : 0;
        if (s.hungryDays >= K.hungryDesertDays) desert += 0.2;
        if (desert > 0 && Utils.random() < desert) {
            const lost = Sieges._loseUnits(player, 1, { mercenaries: false, record: false });
            if (lost) out.notices.push({ title: '🏃 Desertion', text: `Soldiers slip away from the siege lines at ${s.name}.`, type: 'warning' });
        }
    },

    _tributeDay(player, world, out) {
        const st = player.sieges;
        if (!st || !Array.isArray(st.tributes) || !st.tributes.length) return;
        const day = _day(world);
        for (const t of st.tributes) {
            if (day < t.nextDay || t.weeksLeft <= 0) continue;
            const tile = world.getTile ? world.getTile(t.q, t.r) : null;
            const s = tile && tile.settlement;
            if (!s || (s.kingdom || null) !== t.kingdomId) { t.weeksLeft = 0; continue; }
            player.gold = _num(player.gold) + t.amount;
            t.weeksLeft--;
            t.nextDay = day + 7;
            out.notices.push({ title: '💰 Siege Tribute', text: `${t.name} pays its tribute: ${t.amount} gold${t.weeksLeft ? ` (${t.weeksLeft} week(s) to go)` : ' — the last of it'}.`, type: 'success' });
        }
        st.tributes = st.tributes.filter(t => t.weeksLeft > 0);
    },

    // ── Battles and endings ─────────────────────────────────────

    _reliefBattle(player, world, s, initiative) {
        const C = Sieges.config();
        const R = C.relief;
        const relief = s.relief;
        const sally = s.morale >= R.sallyMorale ? Math.round(s.garrison * R.sally) : 0;
        const tile = Sieges._tile(world, s);
        const result = PlayerMilitary.combat(player, relief.strength + sally, relief.name, {
            world, terrainId: tile && tile.terrain && tile.terrain.id, theatre: 'land', defending: !initiative,
        });
        result.success = true;
        result.sally = sally;
        const unit = (world.units || []).find(u => u.id === relief.id);
        if (unit && !result.reason) unit.destroyed = true;
        if (!result.reason && result.victory) {
            s.relief = null;
            s.garrison = Math.max(1, s.garrison - Math.round(sally * 0.5));
            s.morale = Utils.clamp(s.morale - C.defenderMorale.reliefBeaten, 0, 100);
            s.campMorale = Utils.clamp(s.campMorale + C.camp.reliefWon, 0, 100);
            Sieges.state(player).stats.reliefsBeaten++;
            Quests.track(player, 'battles_won');
            House.recordPlayerDeed(player, world, 'battleWon', { reason: `broke the relief of ${s.name}` });
            Sieges._log(s, world, `${relief.name} is broken in the field. ${s.name} is alone.`);
            result.message = `${relief.name} is broken! The defenders of ${s.name} lose heart.`;
            return result;
        }
        const k = Sieges._kingdom(world, relief.kingdomId);
        if (k) k.military = _num(k.military) + Math.round(relief.strength * R.returnShare);
        s.relief = null;
        result.outcome = Sieges._finish(player, world, 'broken', `${relief.name} drives your army from before ${s.name}.`);
        result.message = result.outcome.text;
        return result;
    },

    /** Take the town: conquest (or, in a civil war, its declaration for the pretender). */
    _take(player, world, s, tile, result, how) {
        const C = Sieges.config();
        const settlement = tile && tile.settlement;
        if (!settlement) return Sieges._finish(player, world, 'lifted', 'The town is gone.');
        const surrender = how === 'surrender';
        // A rebel seat of your own realm returns to the crown; its lord is broken
        if (s.revolt) {
            const back = Kingship.onRebelSeatTaken(player, world, s.q, s.r);
            Quests.track(player, 'settlements_captured');
            House.recordPlayerDeed(player, world, 'battleWon', { reason: `retook ${s.name} from rebels` });
            result.revolt = true;
            return Sieges._finish(player, world, 'captured', `${s.name} ${surrender ? 'opens its gates' : 'falls'} and returns to the crown${back && back.lord ? `; ${back.lord} is in chains` : ''} (+${back ? back.gain : 0} momentum against the revolt).`);
        }
        const cw = s.civilWar ? Sieges._civilWar(player, settlement, s.q, s.r) : null;
        if (cw) {
            const k = Sieges._kingdom(world, cw.kingdomId);
            const isCapital = !!(k && k.capital && k.capital.q === s.q && k.capital.r === s.r);
            if (!cw.sides) cw.sides = {};
            cw.sides[`${s.q},${s.r}`] = 'pretender';
            const gain = isCapital ? C.civilWar.capitalMomentum : C.civilWar.momentum;
            cw.momentum = _num(cw.momentum) + gain;
            if (!surrender) cw.battlesWon = _num(cw.battlesWon) + 1;
            Quests.track(player, 'settlements_captured');
            House.recordPlayerDeed(player, world, 'battleWon', { reason: `took ${s.name} for the pretender` });
            result.civilWar = true;
            result.momentum = gain;
            return Sieges._finish(player, world, 'captured', `${s.name} ${surrender ? 'opens its gates and' : 'falls and'} declares for you (+${gain} momentum).`);
        }
        const T = C.terms;
        const opts = surrender
            ? { plunder: T.surrenderPlunder, popKeep: T.surrenderPopKeep, karma: T.surrenderKarma, reputationMult: T.surrenderReputation }
            : {};
        PlayerMilitary.conquerSettlement(player, settlement, tile, world, result, opts);
        if (surrender) {
            Traits.recordDeeds(player, { mercy: 2, honesty: 1 });
            Sieges._court(player, { mercy: 2 });
        }
        return Sieges._finish(player, world, 'captured',
            surrender ? `${s.name} surrenders; its garrison marches out under safe conduct. ${result.newOwner ? `It now belongs to ${result.newOwner}.` : ''}`.trim()
                : `${s.name} is taken by storm. ${result.newOwner ? `It now belongs to ${result.newOwner}.` : ''}`.trim());
    },

    /** Loot the town and leave it burning. */
    _sack(player, world, s, tile, result) {
        const K = Sieges.config().sack;
        const settlement = tile.settlement;
        if (s.revolt) Kingship.onRebelSeatTaken(player, world, s.q, s.r);
        const plunder = Math.floor(_num(settlement.population) * Utils.randFloat(K.plunder[0], K.plunder[1]));
        player.gold = _num(player.gold) + plunder;
        result.plunder = plunder;
        settlement.population = Math.max(1, Math.floor(_num(settlement.population) * K.popKeep));
        settlement.happiness = Utils.clamp(_num(settlement.happiness) + K.happiness, 0, 100);
        settlement.marketStock = {};
        settlement.lastRaidedDay = _day(world);
        player.karma = _num(player.karma) + K.karma;
        result.karmaChange = K.karma;
        Traits.recordAggression(player, s.kingdomId, { cruelty: 4, greed: 3, dread: 3 });
        if (!player.reputation) player.reputation = {};
        for (const k of world.kingdoms || []) {
            if (!k.isAlive) continue;
            player.reputation[k.id] = (player.reputation[k.id] || 0) + (k.id === s.kingdomId ? K.reputation : K.otherReputation);
        }
        if (s.kingdomId) House.accrueRivalFeud(player, world, s.kingdomId, K.feud, `sacked ${s.name}`);
        Sieges._court(player, { severity: K.severity });
        Quests.track(player, 'battles_won');
        if (world.events) world.events.push({ text: `🔥 ${player.name || 'A lord'} sacks ${s.name}!`, type: 'military' });
        Gossip.spreadDeed(player, world, 'sack', { q: s.q, r: s.r, location: s.name, kingdom: s.kingdomId });
        return Sieges._finish(player, world, 'sacked', `${s.name} is sacked: ${plunder} gold in plunder, and the town burns.`);
    },

    /** End the siege. Outcome: captured | sacked | terms | lifted | broken. */
    _finish(player, world, outcome, text) {
        const st = Sieges.state(player);
        const s = st.active;
        if (!s) return { outcome, text };
        // A relief host still on the road goes home
        if (s.relief) Sieges._reliefHome(world, s);
        st.active = null;
        if (st.stats[outcome] != null) st.stats[outcome]++;
        const days = _day(world) - s.startDay;
        st.history.push({ name: s.name, outcome, days, day: _day(world), assaults: s.assaults });
        if (st.history.length > 12) st.history.shift();
        if (player.house && ['captured', 'sacked', 'terms'].includes(outcome)) {
            House._chronicle(player.house, world, `After ${days} day(s) of siege: ${text}`, ['war', 'siege']);
        }
        return { outcome, text, days, name: s.name };
    },

    // ── Helpers ─────────────────────────────────────────────────

    /** Remove up to n land units from the army (the newest first). Returns how many fell. */
    _loseUnits(player, n, opts = {}) {
        let lost = 0;
        for (let i = (player.army || []).length - 1; i >= 0 && lost < n; i--) {
            const u = player.army[i];
            if (PlayerMilitary.isNavalUnit(u)) continue;
            if (opts.mercenaries === false && u.mercenary) continue;
            player.army.splice(i, 1);
            lost++;
        }
        return lost;
    },

    /** Nudge the court reputation (systems/petitions.js), when the player keeps a court. */
    _court(player, deltas) {
        const court = player.petitions && player.petitions.court;
        if (!court) return;
        const cap = _num(Petitions.config().courtCap) || 100;
        for (const [axis, v] of Object.entries(deltas)) {
            court[axis] = Utils.clamp(_num(court[axis]) + v, -cap, cap);
        }
    },

    _log(s, world, text) {
        s.log.push({ day: _day(world), text });
        if (s.log.length > 10) s.log.shift();
    },
};
