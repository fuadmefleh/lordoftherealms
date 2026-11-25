// ============================================
// PLAYTEST BOT — a scripted player for the headless soak test
// ============================================
// Each day the bot looks at what PlayerActions offers on its tile and does a
// handful of things a real player would: eats, trades, recruits, fights,
// founds a colony, joins the Thieves' Guild, delves, rules on petitions, hires
// companions, buys and crews a ship and sails it, presses a claim, and keeps
// clients and raises a Great Work once rich. Where
// an action is only reachable through a UI dialog it calls the system API the
// dialog calls. All choices draw from the seeded Utils RNG, so a run is
// reproducible from its seed.

import { Utils } from '../../core/utils.js';
import { PlayerInventory } from '../../core/inventory.js';
import { Hex } from '../../core/hex.js';
import { WorldUnit } from '../../world/units.js';
import { Colonization } from '../../world/colonization.js';
import { PlayerActions } from '../../player/playerActions.js';
import { PlayerCoin } from '../../player/playerCoin.js';
import { PlayerEconomy, Trading } from '../../player/playerEconomy.js';
import { PlayerMilitary } from '../../player/playerMilitary.js';
import { Treasures } from '../../player/treasures.js';
import { SeasonalWork } from '../../player/seasonalWork.js';
import { Foraging, Hunting } from '../../player/foraging.js';
import { DataLoader } from '../../core/dataLoader.js';
import { OddJobs } from '../../player/oddJobs.js';
import { Begging } from '../../player/begging.js';
import { CoinCensus } from '../../systems/coinCensus.js';
import { MoneySupply } from '../../world/moneySupply.js';
import { Relationships } from '../../systems/relationships.js';
import { Ships } from '../../systems/ships.js';
import { SeaInterception } from '../../systems/seaInterception.js';
import { BlockadeRunning } from '../../systems/blockadeRunning.js';
import { RealmWars } from '../../systems/realmWars.js';
import { RivalHouses } from '../../systems/rivalHouses.js';
import { Landings } from '../../systems/landings.js';
import { Petitions } from '../../systems/petitions.js';
import { Delves } from '../../systems/delves.js';
import { Throne } from '../../systems/throne.js';
import { Kingship } from '../../systems/kingship.js';
import { Espionage } from '../../systems/espionage.js';
import { Underworld } from '../../systems/underworld.js';
import { Gangs } from '../../systems/gangs.js';
import { Prison } from '../../player/prison.js';
import { Companions } from '../../systems/companions.js';
import { Upbringing } from '../../systems/upbringing.js';
import { Heirs } from '../../systems/heirs.js';
import { CadetBranches } from '../../systems/cadetBranches.js';
import { Townsfolk } from '../../systems/townsfolk.js';
import { Hospitality } from '../../systems/hospitality.js';
import { PitFights } from '../../systems/pitFights.js';
import { Ailments } from '../../systems/ailments.js';
import { Sieges } from '../../systems/sieges.js';
import { PlayerHarrying } from '../../player/harrying.js';
import { HoldingSieges } from '../../systems/holdingSieges.js';
import { Discovery } from '../../systems/discovery.js';
import { MerchantHouses } from '../../systems/merchantHouses.js';
import { Quests } from '../../systems/quests.js';
import { Patronage } from '../../systems/patronage.js';
import { OutlawLairs } from '../../systems/outlawLairs.js';
import { Finance } from '../../systems/finance.js';
import { Fiscal } from '../../systems/fiscal.js';
import { CrownBooks } from '../../world/crownBooks.js';
import { Underwriting, KINDS as COVER_KINDS } from '../../systems/underwriting.js';
import { Bills } from '../../systems/bills.js';
import { Bourse } from '../../systems/bourse.js';
import { Thirst } from '../../player/thirst.js';
import { Water } from '../../systems/water.js';
import { Executions } from '../../systems/executions.js';
import { Gibbets } from '../../systems/gibbets.js';
import { PrisonerFates } from '../../player/prisonerFates.js';
import { Interrogation } from '../../systems/interrogation.js';
import { Trials } from '../../player/trials.js';
import { MerchantPrince } from '../../systems/merchantPrince.js';
import { Guilds } from '../../systems/guilds.js';
import { MerchantCaravans } from '../../systems/merchantCaravans.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { Concessions } from '../../systems/concessions.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { Seasons } from '../../world/seasons.js';
import { Harvests } from '../../world/harvests.js';
import { Estates } from '../../world/estates.js';
import { LandMarket } from '../../systems/landMarket.js';
import { PuttingOut } from '../../systems/puttingOut.js';
import { Transport } from '../../world/transport.js';
import { PublicWorks } from '../../systems/publicWorks.js';
import { Mints } from '../../systems/mints.js';
import { RivalAgents } from '../../systems/rivalAgents.js';
import { BloodFeuds } from '../../systems/bloodFeuds.js';
import { Languages } from '../../systems/languages.js';
import { Commissions } from '../../systems/commissions.js';
import { Stewards } from '../../systems/stewards.js';
import { travelTo as harnessTravelTo } from './harness.js';
import { HouseQuests } from '../../systems/houseQuests.js';
import { HolyWars } from '../../systems/holyWars.js';
import { CourtLetters } from '../../systems/courtLetters.js';
import { Devotion } from '../../systems/devotion.js';
import { Plague } from '../../systems/plague.js';
import { Household } from '../../player/household.js';
import { HighCrowns } from '../../systems/highCrowns.js';
import { MEAL_HUNGER } from '../../player/core/needs.js';

const FOOD = ['grain', 'bread'];
// Bought only when there's no grain or bread for sale
const FOOD_FALLBACK = ['fish'];
// Below this purse the bot lives like a poor wanderer: works for wages in
// town, buys a week's bread at a time and spends on nothing grand
const POOR_BELOW = 600;

/**
 * Each life plays with its own temperament, so a long run has rich lives and
 * poor ones rather than one purse held at the same mark for centuries:
 *   poorBelow  works for wages and keeps to the market until this much is saved
 *   ventureAt  grand ventures (voyages, expeditions, colonies, caravans) only above this
 *   spends     lives well in town when there's money: inns' suppers, baths, the valet
 *   courtAt    the purse it wants before courting
 * Picked by a hash of the name (no RNG draw), so a life keeps its temperament
 * through a save and the bot's dice stay as they were.
 */
export const PERSONAS = {
    drifter: { poorBelow: 120, ventureAt: 0, spends: false, courtAt: 150 },
    labourer: { poorBelow: POOR_BELOW, ventureAt: 0, spends: false, courtAt: 400 },
    saver: { poorBelow: 2500, ventureAt: 8000, spends: false, courtAt: 1000 },
    merchant: { poorBelow: 1200, ventureAt: 1200, spends: false, courtAt: 800 },
    spendthrift: { poorBelow: 250, ventureAt: 0, spends: true, courtAt: 200 },
};
const PERSONA_IDS = Object.keys(PERSONAS);

/** This life's temperament: { id, ...PERSONAS[id] }. */
export function personaOf(game) {
    const name = String((game.player && game.player.name) || '');
    if (!game._persona || game._persona.name !== name) {
        let h = 2166136261;
        for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
        const id = PERSONA_IDS[(h >>> 0) % PERSONA_IDS.length];
        game._persona = { name, id, ...PERSONAS[id] };
    }
    return game._persona;
}
/** The temperament in play: past the short soak's horizon (whose runs stay as they were), the life's own. */
const temper = (game) => (game.world.day > 150 ? personaOf(game) : { id: 'labourer', ...PERSONAS.labourer });
/**
 * The company savings plan. A House with no trading company sets money by for
 * one once it is settled in (past day 150): the charter of the cheapest crown
 * that would grant one (in good standing, not at war: plan.kingdomId) and
 * COMPANY_CAPITAL to put in. No crown will: no plan (it waits on its standing). Until its savings (the purse
 * and its bank deposits) hold that, the bot lives as a poor wanderer does (day
 * labour and the market, nothing grand, no soldiers on wages): poorBelow rises
 * to the target, and what it earns goes to the bank, out of the cutpurses' and
 * robbers' reach (banking). Once the sum is put by, it draws it at a branch of
 * its bank and founds the company (company). A drifter never saves. A plan that has not
 * come off in COMPANY_PLAN_DAYS (five years: wages and upkeep eating what the
 * labour earns) is set aside for three years (the bot lives as it likes) and
 * tried again. → the gold wanted, or 0.
 */
// (enough to open a first post, 350g, and keep 800 in the coffers for its orders)
const COMPANY_CAPITAL = 1400;
const COMPANY_PLAN_DAYS = 600;
function companyTarget(game) {
    const { player, world } = game;
    if (world.day <= 150 || temper(game).id === 'drifter' || MerchantHouses.hasCompany(player)) return 0;
    // (a crowned ruler does not labour town to town to save for a company: the levy is its income,
    // and the plan's frugality paid off the royal guard each morning)
    if (Throne.ruledKingdom(player, world)) return 0;
    const plan = game.companyPlan || (game.companyPlan = { from: world.day });
    if (world.day - plan.from > COMPANY_PLAN_DAYS) {
        if (world.day - plan.from < COMPANY_PLAN_DAYS + 360) return 0;
        plan.from = world.day;
    }
    if (MerchantHouses.hasCharter(player) || MerchantHouses.officeCharter(player)) return COMPANY_CAPITAL;
    // (the cheapest willing crown, reckoned once a day)
    if (plan.day !== world.day) {
        const minRep = MerchantHouses.config().charter.minReputation;
        const rep = player.reputation || {};
        // (a crown whose every town the bot has failed to reach, over the sea, is no use)
        // (and, on foot, only those on its own landmass: the trip there walks — see nearest())
        const walk = typeof player._overlandReachable === 'function' ? (t) => player._overlandReachable(t.q, t.r, world) : () => true;
        const reachable = new Set(settlementTiles(world).filter(t => !(game.unreachableSites && game.unreachableSites.has(`${t.q},${t.r}`)) && walk(t))
            .map(t => { const st = world.getTile(t.q, t.r).settlement; return st && st.kingdom; }));
        let best = null;
        for (const k of world.kingdoms || []) {
            if (!k || !k.isAlive || (rep[k.id] || 0) < minRep || RealmWars.atWarWith(player, k.id) || !reachable.has(k.id)) continue;
            const cost = MerchantHouses.charterCost(world, k);
            if (!best || cost < best.cost) best = { id: k.id, cost };
        }
        plan.day = world.day;
        plan.kingdomId = best ? best.id : null;
        plan.charter = best ? best.cost : null;
    }
    return plan.charter == null ? 0 : plan.charter + COMPANY_CAPITAL;
}
/** The purse and what lies in the bank. */
function savings(player) {
    const accts = Object.values(Finance.state(player).accounts || {});
    return (player.gold || 0) + accts.reduce((a, x) => a + Math.max(0, x.balance || 0), 0);
}
/** Putting money by for the company now: below the plan's sum, the bot labours for it. */
const savingNow = (game) => {
    const t = companyTarget(game);
    return t > 0 && savings(game.player) < t;
};
const poorBelow = (game) => Math.max(temper(game).poorBelow, savingNow(game) ? companyTarget(game) : 0);
/**
 * While the plan runs (saving, or the sum put by and the bot on its way to a
 * crown that will charter it) it spends on nothing it can do without: no new
 * soldiers or companions, ventures, lessons or luxuries. (Investments keep
 * their own thresholds, well above the plan's sum: a purse that rich founds first.)
 */
const frugal = (game) => companyTarget(game) > 0;
/** The plan's sum is put by (drawn, or about to be): it is for the charter and the company's capital, not land or leases. */
const founding = (game) => { const t = companyTarget(game); return t > 0 && savings(game.player) >= t; };
const JOB_AP = 4;

/**
 * Travel as the harness does, but a hex being crossed over days is crossed
 * first when it is on the way (nearer the goal than where the bot stands):
 * setting out from mid-hex by another road throws the way made into it away
 * (Player.moveTo), and a life that changed its mind each morning sat on one
 * highland hex for a week and starved with 1,500 gold in its purse.
 */
/**
 * Thirsty with the skins dry and no water here: the nearest river, lake or
 * clean town within a few hexes first (player/thirst.js, systems/water.js).
 * → true when the bot turned aside for it today.
 */
function waterDetour(game) {
    const { player, world } = game;
    if (player.boardedShip != null || !Thirst.on(player)) return false;
    if (Thirst.level(player) >= 35 || Thirst.held(player) >= 1 || Thirst.sourceHere(player, world)) return false;
    let best = null;
    for (let dr = -4; dr <= 4; dr++) {
        for (let dq = -4; dq <= 4; dq++) {
            const tq = Hex.wrapQ(player.q + dq, world.width), tr = player.r + dr;
            const src = Water.sourceAt(world, tq, tr);
            if (!src || src.foul) continue;
            const d = Hex.wrappingDistance(player.q, player.r, tq, tr, world.width);
            if (!best || d < best.d) best = { q: tq, r: tr, d };
        }
    }
    if (!best) return false;
    count(game._roadStats || (game._roadStats = {}), 'waterDetour');
    harnessTravelTo(game, best.q, best.r);
    return true;
}

function travelTo(game, q, r) {
    const { player, world } = game;
    // (the skins dry and thirsty: water first)
    if (waterDetour(game)) return false;
    const c = !player.boardedShip && typeof player.crossingStatus === 'function' ? player.crossingStatus(world) : null;
    const w = world.width;
    // Out of a town that sells bread, not on fewer meals than the road may take
    // (two days a hex at the worst, hills and highlands) — whichever errand sets out
    const here = !player.boardedShip && player.gold >= 30 ? world.getTile(player.q, player.r) : null;
    if (here && here.settlement && (q !== player.q || r !== player.r)) {
        const need = Math.min(25, 2 * Hex.wrappingDistance(player.q, player.r, q, r, w) + ROAD_SPARE);
        for (let i = 0; i < 3 && player.getFoodCount() < need; i++) {
            const before = player.getFoodCount();
            booked(game, 'buyFood', () => buyFood(game, here, game._roadStats || (game._roadStats = {}), { larder: need - 1 }));
            if (player.getFoodCount() <= before) break;
        }
    }
    if (c && (c.q !== q || c.r !== r) && Hex.wrappingDistance(c.q, c.r, q, r, w) < Hex.wrappingDistance(player.q, player.r, q, r, w)) {
        harnessTravelTo(game, c.q, c.r);
        if (player.q !== c.q || player.r !== c.r) return false;
    }
    // (the gate guards' word, as the game loop tells and clears it: ui/innerMapPlague.js turnedAway)
    player.turnedAway = null;
    const arrived = harnessTravelTo(game, q, r);
    const tw = player.turnedAway;
    if (tw) {
        player.turnedAway = null;
        const s = world.getTile(tw.q, tw.r) && world.getTile(tw.q, tw.r).settlement;
        if (s) {
            // Turned back at a plague town's shut gates: starving, slip the guards their price
            // (systems/plague.js bribeGate — a crime) rather than die at the walls; else that
            // town is no use for a while (nearest() passes it over). Lives starved a hex from
            // a shut gate, trying it each morning.
            const stats = game._roadStats || (game._roadStats = {});
            if (player.getFoodCount() <= 3 && player.gold >= Plague.bribeCost(s) + 30 && Plague.bribeGate(player, world, s).success) {
                count(stats, 'gateBribed');
                return harnessTravelTo(game, q, r);
            }
            shutSeen(player)[`${tw.q},${tw.r}`] = world.day;
            count(stats, 'gateShut');
        }
    }
    return arrived;
}

// Towns whose gates the bot was turned back from, by player: { 'q,r': day }
const _shut = new WeakMap();
function shutSeen(player) {
    let m = _shut.get(player);
    if (!m) _shut.set(player, (m = {}));
    return m;
}

// Bread, grain and fish a town's stalls can sell today, in whole units. Under
// STALL_ENOUGH (a few days' meals) a town counts as bare: a crowned life with
// 2,000 gold starved in a village that put out one sack of grain a day, buying
// it each morning and staying for the next (round 3's endgame soak, seed 101).
const STALL_ENOUGH = 3;
function stallFood(settlement) {
    return [...FOOD, ...FOOD_FALLBACK].reduce((a, id) => a + Math.floor(SettlementMarket.available(settlement, id) || 0), 0);
}

// The days of food the packs are kept at in a town that sells it, and the
// spare days a journey is set out on beyond its own length
const LARDER = 12;
const ROAD_SPARE = 2;
/** Days on the road to (q, r) as the player would walk it now (Player.travelEstimate), or null with no way. */
function tripDays(game, q, r) {
    const { player, world } = game;
    if (player.q === q && player.r === r) return 0;
    const est = typeof player.travelEstimate === 'function' ? player.travelEstimate(world, q, r) : null;
    return est ? Math.ceil(est.travelDays || est.days || 0) : null;
}
/** Enough in the packs for the road to (q, r) and a little over (`legs` 2: there and back)? */
function fedFor(game, q, r, legs = 1) {
    const d = tripDays(game, q, r);
    return d == null || game.player.getFoodCount() >= d * legs + ROAD_SPARE;
}
/**
 * Hold to the town last set out for while it is still among `list` (the day's
 * candidates) and not yet reached, else take `pick` (default the first) and
 * remember it. Choosing the nearest afresh each morning from a new hex between
 * two towns walked lives back and forth across one hex until they starved.
 */
function stick(game, list, pick = list[0]) {
    const { player, world } = game;
    const h = game.headingTo;
    const keep = h && world.day - h.day <= 20 && (player.q !== h.q || player.r !== h.r) ? list.find(t => t.q === h.q && t.r === h.r) : null;
    if (keep) return keep;
    if (pick) game.headingTo = { q: pick.q, r: pick.r, day: world.day };
    return pick || null;
}
/** In a town with food on its stalls: top the packs up to LARDER before the road. */
function stockUp(game, stats) {
    const { player, world } = game;
    if (player.boardedShip || player.getFoodCount() >= LARDER || player.gold < 30) return;
    const here = world.getTile(player.q, player.r);
    if (!here || !here.settlement) return;
    booked(game, 'buyFood', () => buyFood(game, here, stats, { larder: LARDER - 1 }));
}

function count(stats, key, n = 1) {
    stats[key] = (stats[key] || 0) + n;
}

/** Run a bot step and book its gold change to the game ledger under `label`. */
function booked(game, label, fn) {
    const before = game.player.gold;
    // BOT_COIN=1: the census around each of the bot's actions, and any that moved coin unbooked
    const audit = typeof process !== 'undefined' && process.env.BOT_COIN;
    const c0 = audit ? CoinCensus.total(game.world, game.player).total - MoneySupply.bookedChange(game.world) : 0;
    const out = fn();
    if (audit) {
        const u = CoinCensus.total(game.world, game.player).total - MoneySupply.bookedChange(game.world) - c0;
        if (Math.abs(u) > 1) process.stdout.write(`BOTCOIN day ${game.world.day} bot:${label} ${u.toFixed(2)}\n`);
    }
    const d = game.player.gold - before;
    if (d && Number.isFinite(d)) {
        // SOAK_METRICS: a windfall the size of a realm's treasury is worth a look
        if (Math.abs(d) > 20000 && typeof process !== 'undefined' && process.env.SOAK_METRICS) {
            process.stdout.write(`WINDFALL day ${game.world.day} bot:${label} ${Math.round(d)}g (gold ${Math.round(game.player.gold)})\n`);
        }
        game.ledger = game.ledger || {};
        game.ledger[`bot:${label}`] = Math.round((game.ledger[`bot:${label}`] || 0) + d);
    }
    return out;
}

// Settlement positions per world, refreshed every 30 days (realms found and lose towns)
const _settlementCache = new WeakMap();
function settlementTiles(world) {
    const cached = _settlementCache.get(world);
    if (cached && world.day - cached.day < 30) return cached.list;
    const list = world.getAllSettlements().map(s => ({ q: s.q, r: s.r }));
    _settlementCache.set(world, { day: world.day, list });
    return list;
}

// (from the player, only places it can get to from here: on foot, those on its own landmass —
// a town over the sea is no use to a walker, and asking for the way there only fails)
// (and not one whose plague-shut gates turned it back these ten days, while there are others)
/** The nearest town (by road) whose stalls have bread enough, or null: a starving life's last walk. */
function marketNear(game) {
    const { player, world } = game;
    const stocked = settlementTiles(world).filter(t => {
        const tile = world.getTile(t.q, t.r);
        return tile && tile.settlement && stallFood(tile.settlement) >= STALL_ENOUGH;
    });
    return nearest(world, player, stocked, 1)[0] || null;
}

function nearest(world, from, list, n = 6) {
    const reach = from && typeof from._overlandReachable === 'function' ? (t) => from._overlandReachable(t.q, t.r, world) : null;
    const shut = from && _shut.get(from);
    const out = list
        .map(t => ({ ...t, d: Hex.wrappingDistance(from.q, from.r, t.q, t.r, world.width) }))
        .filter(t => t.d > 0 && (!reach || reach(t)))
        .sort((a, b) => a.d - b.d);
    const open = shut ? out.filter(t => !(world.day - (shut[`${t.q},${t.r}`] ?? -1e9) < 10)) : out;
    return (open.length ? open : out).slice(0, n);
}

// ── Settlement business ─────────────────────────────────────

function buyFood(game, tile, stats, opts = {}) {
    const { player, world } = game;
    if (player.getFoodCount() >= 25) return;
    const goods = Trading.getAvailableGoods(tile.settlement, tile, world);
    for (const id of FOOD) {
        const g = goods.find(x => x.id === id);
        if (!g || g.quantity <= 0) continue;
        // Each unit costs a little more than the last as the stall empties
        const qty = Trading.affordable(player, g, tile.settlement, player.gold < poorBelow(game) ? 8 : 30);
        if (qty <= 0) continue;
        const res = Trading.buyGoods(player, g, qty, tile.settlement);
        if (res.success) { count(stats, 'foodBought', qty); return; }
    }
    // No grain or bread to be had (a dearth, a guild's bread monopoly): anything
    // edible, fish first, then the cheapest of what the stalls have (a new life
    // once starved in a town of cheese and meat with gold in the purse; topping the packs
    // up for the road, opts.larder, the same: beans and onions over setting out on two days' bread)
    if (player.getFoodCount() > (opts.larder || 2)) return;
    const edible = player.constructor.FOOD_TYPES || [];
    const others = goods.filter(g => edible.includes(g.id) && !FOOD.includes(g.id) && !FOOD_FALLBACK.includes(g.id))
        .sort((a, b) => (a.price || 0) - (b.price || 0)).map(g => g.id);
    for (const id of [...FOOD_FALLBACK, ...others]) {
        const g = goods.find(x => x.id === id);
        if (!g || g.quantity <= 0) continue;
        const qty = Trading.affordable(player, g, tile.settlement, 20);
        if (qty <= 0) continue;
        const res = Trading.buyGoods(player, g, qty, tile.settlement);
        if (res.success) { count(stats, 'foodBought', qty); return; }
    }
}

/** A day's labour in town (ui/actionMenu/jobs.js → OddJobs.complete), as many jobs as the AP allows. */
function dayLabour(game, tile, stats) {
    const { player, world } = game;
    const table = DataLoader.earlyJobs && DataLoader.earlyJobs.oddJobs && DataLoader.earlyJobs.oddJobs.settlement_jobs;
    if (!table) return;
    const jobs = table[tile.settlement.type] || table.town || [];
    if (!jobs.length) return;
    while ((player.actionPoints || 0) >= JOB_AP) {
        // The best-paid work the bot is fit for: the job whose stat it is strongest in
        const job = jobs.reduce((a, b) => (OddJobs.statValue(player, b.stat) + b.pay.max / 10 > OddJobs.statValue(player, a.stat) + a.pay.max / 10 ? b : a));
        player.actionPoints -= JOB_AP;
        const res = OddJobs.complete(player, world, tile.settlement, job, 40 + Math.floor(Utils.random() * 40));
        count(stats, 'oddJobs');
        // A broke town pays what its purse holds, maybe nothing: noted, so a pauper moves on (botDay)
        if (res && res.factors && res.factors.short > 0) (game.brokeTowns || (game.brokeTowns = {}))[`${tile.q},${tile.r}`] = world.day;
    }
}

function sellGoods(game, tile, stats) {
    const { player, world } = game;
    const held = PriceKnowledge.state(player).pnl.held;
    const crowded = PlayerInventory.getUsedSlots(player) > PlayerInventory.getCapacity(player) * 0.75;
    for (const [id, held0] of Object.entries({ ...player.inventory })) {
        let qty = held0;
        if (FOOD.includes(id) || !(qty > 0) || id === 'gold') continue;
        // Bullion bought for a mint is carried there (chooseDestination), not sold in passing
        if (BULLION.includes(id) && !crowded && player.gold >= 300) continue;
        // (food beyond the packs' keep only: the whole lot went at once, and a king left a
        // village with 97 days' food down to 10 starved on the road home — seed 101 2026-11-24)
        if (FOOD_FALLBACK.includes(id)) {
            qty = Math.min(qty, player.getFoodCount() - LARDER * 2);
            if (!(qty > 0)) continue;
        }
        if (Treasures.info(id) && Utils.random() < 0.5) continue;
        // Goods bought to trade are held until a market pays what they cost
        // (the price book's average cost), unless the purse is running dry or the packs fill
        const lot = held[id];
        const good = PlayerEconomy.GOODS[id.toUpperCase()];
        if (lot && lot.qty > 0 && good && player.gold >= 500 && !crowded
            && Trading.saleUnitPrice(player, good, tile.settlement, world, 1, qty) < (lot.cost / lot.qty) * 1.05) continue;
        const res = Trading.sellGoods(player, id, qty, tile.settlement, world);
        if (res.success) { count(stats, 'sales'); continue; }
        // Hot goods to a fence, contraband to the black market
        if (Underworld.canUseFence(player, tile.settlement)) {
            const f = Underworld.sellToFence(player, world, tile, id, qty);
            if (f.success) { count(stats, 'fenced'); continue; }
        }
        // (a raid fines half the deal's worth: never stake more than a quarter of the purse on one —
        // a seed-202 life lost 866g of 870 to one raid, then starved broke)
        const bmPrice = Underworld.blackMarketPrice(world, tile, id) || 0;
        const bmQty = bmPrice > 0 ? Math.min(qty, Math.floor((player.gold * 0.25) / (bmPrice * 0.5))) : 0;
        if (bmQty < 1) continue;
        const bm = Underworld.sellBlackMarket(player, world, tile, id, bmQty);
        if (bm.success) count(stats, 'blackMarket');
    }
}

/**
 * Buy a lot to sell elsewhere — only when the price book (what the bot has
 * seen or been told, systems/priceKnowledge.js) knows a market within a few
 * days' travel paying well over today's asking price here.
 */
function speculate(game, tile, stats) {
    const { player, world } = game;
    if (player.gold < 4000 || Utils.random() > 0.25) return;
    const here = `${tile.q},${tile.r}`;
    const outlet = (g) => PriceKnowledge.known(player, world, g.id)
        .some(k => k.key !== here && k.age <= 20 && k.bid > g.price * 1.2
            && Hex.wrappingDistance(k.q, k.r, tile.q, tile.r, world.width) <= PriceKnowledge.config().hexesPerDay * 8);
    const goods = Trading.getAvailableGoods(tile.settlement, tile, world)
        .filter(g => !FOOD.includes(g.id) && g.quantity > 0 && g.price > 0 && outlet(g));
    if (!goods.length) return;
    const g = Utils.randPick(goods);
    const qty = Math.min(Trading.affordable(player, g, tile.settlement, 5), Math.floor((player.gold * 0.05) / g.price));
    if (qty > 0 && Trading.buyGoods(player, g, qty, tile.settlement).success) count(stats, 'speculation');
}

function recruit(game, tile, stats) {
    const { player, world } = game;
    const cap = player.gold > 8000 ? 12 : 6;
    if ((player.army || []).length >= cap || player.gold < 2500) return;
    const isPort = Ships.isPortTile(world, tile.q, tile.r);
    for (const type of ['soldier', 'archer', 'pikeman', 'militia', 'war_galley']) {
        const res = PlayerMilitary.recruitUnit(player, type, tile.settlement, { world, isPort });
        if (res.success) { count(stats, 'recruited'); if (player.army.length >= cap) return; }
    }
}

function underworld(game, tile, stats) {
    const { player, world } = game;
    if (!Underworld.hasGuildPresence(tile.settlement)) return;
    const st = Underworld.ensure(player);
    if (!st.guild.contactMet && Underworld.meetContact(player, world, tile).success) count(stats, 'guildContact');
    if (!st.guild.member && player.gold > 600 && Underworld.joinGuild(player, world, tile).success) count(stats, 'guildJoined');
    if (st.guild.member && Utils.random() < 0.3 && Underworld.getHeat(player, tile.settlement.kingdom) < 40) {
        const jobs = Underworld.availableJobs(player, world, tile).filter(j => !j.locked && j.id !== 'heist');
        if (jobs.length) {
            const job = Utils.randPick(jobs);
            const res = Underworld.doJob(player, world, tile, job.id);
            if (res.success) count(stats, `job_${res.outcome}`);
        }
    }
}

/**
 * The town's gangs (systems/gangs.js): with a guild contact, run with the
 * crew holding the most streets, run its errands while the heat allows, rise
 * in it and, as a lieutenant with good odds, take it over; as boss (the Crime
 * Lord start, or a gang taken) keep the purse working; and wash dirty coin
 * through a front. Past the short soak's horizon, or as a boss from the start.
 */
function gangLife(game, tile, stats) {
    const { player, world } = game;
    const s = tile.settlement;
    if (!Gangs.hasGangs(s)) return;
    const boss = Gangs.isBoss(player, world, tile);
    if (world.day <= 150 && !Gangs.bossTowns(player, world).length) return;
    const uw = Underworld.ensure(player);
    const heat = Underworld.getHeat(player, s.kingdom);
    let m = Gangs.membership(player, tile);
    // (a crew in two towns at most: a life of its own beyond the streets)
    if (!m && (uw.guild.contactMet || uw.guild.member) && heat < 40 && Object.keys(uw.gangs || {}).length < 2 && Utils.random() < 0.25) {
        const g = Gangs.gangsAt(world, tile).filter(x => !x.banned && !(x.boss && x.boss.player)).sort((a, b) => b.turf - a.turf)[0];
        if (g && Gangs.join(player, world, tile, g.id).success) {
            count(stats, 'gangJoined');
            m = Gangs.membership(player, tile);
        }
    }
    if (m) {
        if (boss) bossDay(game, tile, stats);
        if (heat < 45 && Utils.random() < 0.4) {
            // The surest job it can do today (a kidnapping only now and then: the watch never forgets)
            const open = Gangs.errands(player, world, tile)
                .filter(e => !e.locked && (player.actionPoints || 0) >= e.ap && (e.id !== 'kidnap' || Utils.random() < 0.05))
                .sort((a, b) => b.odds - a.odds);
            if (open.length) {
                const res = Gangs.doErrand(player, world, tile, open[0].id);
                if (res.success) {
                    count(stats, 'gangErrands');
                    count(stats, `gangErrand_${res.outcome}`);
                    if (res.promoted) count(stats, 'gangRankUp');
                }
            }
        }
        if (!boss && m.rank >= Gangs.BOSS_RANK() - 1 && (player.actionPoints || 0) >= 4
            && Gangs.challengeOdds(player, world, tile) >= 0.6 && Utils.random() < 0.1) {
            const res = Gangs.challengeBoss(player, world, tile);
            if (res.success) count(stats, res.outcome === 'success' ? 'gangTaken' : 'gangChallengeLost');
        }
    }
    // Dirty coin through a front here (a tavern, an inn... or the gang's dens)
    const dirty = Gangs.dirty(player);
    if (dirty >= 50) {
        const cap = Gangs.launderCapacity(player, world, tile);
        if (cap.fronts.length && cap.left > 0 && Gangs.launder(player, world, tile, Math.min(Math.floor(dirty), cap.left)).success) count(stats, 'laundered');
    }
}

/** The boss's week: a fair cut, the watch bought, men signed, lieutenants kept sweet, a fat purse drawn on. */
function bossDay(game, tile, stats) {
    const { player, world } = game;
    const s = tile.settlement;
    const g = Gangs.myGang(player, world, tile);
    if (!g) return;
    const st = Gangs.town(world, tile);
    const wages = Gangs.weeklyWages(g);
    const order = (op, arg) => {
        const r = Gangs.bossAct(player, world, tile, op, arg);
        if (r.success) count(stats, 'bossOrders');
        return r;
    };
    const cuts = Gangs.c('cuts', [0.1, 0.25, 0.4]);
    if (Math.abs(g.cut - (Gangs.c('lieutenants', {}).fairCut || 0.25)) > 0.001) order('cut', Math.max(0, cuts.indexOf(0.25)));
    for (const who of ['captain', 'magistrate']) {
        const fee = Gangs.retainer(world, tile, who);
        const want = who === 'captain' ? st.watch.crackdown >= 30 : g.purse > fee * 6 + wages * 4;
        if (want && !st.watch[who].bribedBy && g.purse > fee * 2 + wages * 2) order(who);
    }
    for (const lt of g.lieutenants.slice()) {
        if (lt.loyalty < 40 && g.purse > (Gangs.c('lieutenants', {}).bonusCost || 50) + wages) order('bonus', lt.id);
    }
    if (g.purse > wages * 6 && g.crew < Gangs.crewCap(s)) order('hire', 2);
    const D = Gangs.c('dens', {});
    if (g.purse > (D.openCost || 220) * 2 + wages * 3 && Utils.random() < 0.1) order('den');
    for (const foe of Gangs.rivals(world, tile, g)) {
        if (Gangs.atWar(g, foe) && g.crew < foe.crew * 0.7) order('truce', foe.id);
    }
    if (g.purse > wages * 10 + 300) order('withdraw', Math.floor((g.purse - wages * 8) / 2));
}

/**
 * In a cell: word to the crew first (the magistrate the gang keeps, then a
 * bribed gaoler, then the men over the wall when the odds are good), else
 * bail when the purse can spare it three times over. → true when out.
 */
function leaveJail(game, stats) {
    const { player, world } = game;
    const jail = player.jailState;
    if (!jail) return true;
    const opts = Prison.crewOptions(player, world).filter(o => o.can);
    const pick = opts.find(o => o.id === 'magistrate') || opts.find(o => o.id === 'bribe' && o.chance >= 0.5)
        || opts.find(o => o.id === 'breakout' && o.chance >= 0.6);
    if (pick) {
        const r = Prison.sendWord(player, world, pick.id);
        if (r.success) count(stats, r.ok ? 'crewSprung' : 'crewFailed');
        if (!player.jailState) return true;
    }
    if (jail.bailCost && player.gold > jail.bailCost * 3 && Prison.postBail(player, world).success) {
        count(stats, 'bailed');
        return true;
    }
    return false;
}

function properties(game, tile, stats) {
    const { player, world } = game;
    // Collect what the holdings made, and invest when flush
    if ((player.properties || []).length && Utils.random() < 0.5) {
        const got = PlayerEconomy.collectGoods(player, world);
        if (got && Object.keys(got.collected || got || {}).length) count(stats, 'collections');
    }
    if ((player.properties || []).length >= 4 || player.gold < 4500) return;
    for (const type of ['TAVERN', 'FARM', 'TRADING_POST', 'BREWERY', 'BAKERY', 'FISHING_WHARF', 'LOGGING_CAMP']) {
        if (PlayerEconomy.buildProperty(player, type, tile, world).success) { count(stats, 'propertiesBuilt'); return; }
    }
}

function work(game, tile, stats) {
    const { player, world } = game;
    if (SeasonalWork.signPlantingContract(player, tile.settlement, world).success) count(stats, 'plantingContracts');
    if (!player.allegiance && tile.settlement.type === 'capital' && tile.settlement.kingdom && Utils.random() < 0.5) {
        if (player.pledgeAllegiance(tile.settlement.kingdom, world).success) count(stats, 'pledged');
    }
}

function companions(game, tile, stats) {
    const { player, world } = game;
    Relationships.ensureTravelParty(player);
    if (player.travelParty.length >= 2 || player.gold < 500 || Utils.random() > 0.3) return;
    const npcs = Relationships.getNPCsAtSettlement(tile, world).filter(n => !player.travelParty.includes(n.id));
    if (!npcs.length) return;
    const npc = Utils.randPick(npcs);
    const rel = Relationships.getRelationship(player, npc.id);
    rel.score = Math.max(rel.score || 0, 30);
    const res = Relationships.requestJoinTravelParty(player, npc.id, world);
    if (res.success) count(stats, 'companionsHired');
}

/**
 * Stewards (systems/stewards.js): with several seats, put someone over each,
 * set orders by what the place needs, audit the suspect, fine the caught,
 * answer a steward's proposal. Weekly.
 */
export function stewards(game, stats) {
    const { player, world } = game;
    if ((world.day || 0) % 7 !== 3) return;
    const seats = Stewards.seats(player, world);
    // Several seats, or a holding that drifts ungoverned while the bot is on the road
    if (seats.length < 2 && !seats.some(s => s.kind === 'holding')) return;
    const filled = Stewards.fillVacant(player, world).filled;
    if (filled) count(stats, 'stewardsAppointed', filled);
    const v = Stewards.view(player, world);
    for (const s of v.seats) {
        const o = s.office;
        if (!o) continue;
        let want = s.kind === 'company' ? 'watch' : 'revenue';
        if (s.kind === 'holding' && (s.unrest || 0) >= 45) want = 'peace';
        else if ((s.happiness != null && s.happiness < 40) && (s.kind === 'holding' || s.kind === 'province' || s.kind === 'estates')) want = 'fed';
        if (o.orders !== want && Stewards.orders(s.kind)[want]) Stewards.setOrders(player, world, s.id, want);
        if (s.kind === 'holding' && !o.allowance && (player.gold || 0) > 3000) Stewards.setAllowance(player, world, s.id, 250);
        if (o.caught) {
            if (Stewards.punish(player, world, s.id, o.loyalty < 30 ? 'disgrace' : 'fine').success) count(stats, 'stewardsPunished');
        } else if ((o.suspicion || o.power >= 60) && o.auditReady && (player.gold || 0) > o.auditCost * 4) {
            const r = Stewards.audit(player, world, s.id);
            if (r.success) count(stats, r.found ? 'stewardAuditsFound' : 'stewardAudits');
        } else if (o.loyalty < 35 && (player.gold || 0) > 1000) {
            if (Stewards.reward(player, world, s.id, 'gold').success) count(stats, 'stewardsRewarded');
        }
    }
    for (const p of v.pending) {
        const seat = v.seats.find(x => x.id === p.seatId);
        if (Stewards.answer(player, world, p.id, !!(seat && seat.office && seat.office.loyalty >= 55)).success) count(stats, 'stewardProposals');
    }
}

function court(game, stats) {
    const { player, world } = game;
    for (const pet of Petitions.pending(player).slice()) {
        const def = Petitions.defOf(pet);
        const choices = ((def && def.choices) || []).filter(c => Petitions.canChoose(player, pet, c).ok);
        if (!choices.length) continue;
        const res = Petitions.rule(player, world, pet.id, Utils.randPick(choices).id);
        if (res.success) count(stats, 'petitionsRuled');
    }
}

// The trading company: charter and found it, open posts, set standing
// orders, take contracts and send convoys, draw profits, invest
function company(game, tile, stats) {
    const { player, world } = game;
    let c = MerchantHouses.company(player);
    if (!c) {
        // (3,500: the purse runs a little thinner now that food and sales
        // follow each town's real stock — world/settlementMarket.js)
        // Not with the starting purse: a company founded in the first weeks
        // starves the bot of bread money (it founds one once there's a cushion)
        // Saving for it (companyTarget): found it as soon as the purse holds the plan's sum
        const target = companyTarget(game);
        // (at the plan's crown with the charter's price in the purse: buy it here and now —
        // not first off to a bank in another realm, where no charter is sold to it — and
        // save for the capital after)
        const plan = game.companyPlan;
        const atPlan = !!(target && plan && plan.kingdomId != null && tile.settlement && tile.settlement.kingdom === plan.kingdomId
            && !MerchantHouses.hasCharter(player) && player.gold >= (plan.charter || 0));
        if (atPlan && MerchantHouses.buyCharter(player, world, tile).success) count(stats, 'chartersBought');
        if (target) {
            if (savings(player) < target) {
                // (the charter's price and a bread purse in hand: off to the plan's crown to buy
                // the charter now, and save the capital after — a purse that never holds charter
                // and capital at once still gets there)
                const kid = plan && plan.kingdomId;
                if (kid != null && !atPlan && !MerchantHouses.hasCharter(player) && !MerchantHouses.officeCharter(player)
                    && player.gold >= (plan.charter || 0) + 250 && !(game.dest && game.dest.company)) {
                    const town = nearest(world, player, settlementTiles(world), 400).find(t => {
                        const st = world.getTile(t.q, t.r).settlement;
                        return st && st.kingdom === kid && !(game.unreachableSites && game.unreachableSites.has(`${t.q},${t.r}`));
                    });
                    if (town) game.dest = { q: town.q, r: town.r, company: true };
                }
                return;
            }
            // The sum is put by, much of it in the bank: draw it here, or make for a branch that holds it
            if (player.gold < target) {
                const st = Finance.state(player);
                for (const b of Finance.banksAt(player, world, tile)) {
                    if (st.accounts[b.id] && Finance.withdraw(player, world, b.id).success) count(stats, 'savingsDrawn');
                }
                if (player.gold < target) {
                    const town = nearest(world, player, settlementTiles(world), 30)
                        .find(t => Finance.banksAt(player, world, world.getTile(t.q, t.r)).some(b => st.accounts[b.id]));
                    if (town) game.dest = { q: town.q, r: town.r, company: true };
                    return;
                }
            }
        } else {
            if (player.gold < 3500 || Utils.random() > 0.3) return;
            if (world.day < 40 && player.gold < 9000) return;
        }
        if (!MerchantHouses.hasCharter(player) && !MerchantHouses.officeCharter(player)) {
            if (MerchantHouses.buyCharter(player, world, tile).success) count(stats, 'chartersBought');
            else if (target) {
                // This crown won't (the plan's crown is game.companyPlan.kingdomId): make for that crown's nearest town
                const kid = game.companyPlan && game.companyPlan.kingdomId;
                const town = nearest(world, player, settlementTiles(world), 400)
                    .find(t => {
                        const st = world.getTile(t.q, t.r).settlement;
                        return st && st.kingdom === kid && !(game.unreachableSites && game.unreachableSites.has(`${t.q},${t.r}`));
                    });
                // (held to until reached, like a delve site)
                if (town) game.dest = { q: town.q, r: town.r, company: true };
                count(stats, 'charterRefused');
                return;
            }
        }
        // (on the plan, the capital it saved for, keeping a bread purse of 250g; otherwise half the purse)
        const capital = Math.min(4000, Math.floor(target ? Math.max(500, Math.min(COMPANY_CAPITAL, player.gold - 250)) : player.gold * 0.5));
        if (MerchantHouses.found(player, world, { capital }).success) count(stats, 'companyFounded');
        c = MerchantHouses.company(player);
        if (!c) return;
    }
    let post = MerchantHouses.postAt(player, tile.q, tile.r);
    if (!post && c.posts.length < 3 && c.capital > 800 && Utils.random() < 0.5) {
        const cands = MerchantHouses.candidates(player, world, tile);
        const best = cands.reduce((bi, f, i) => (f.skill > cands[bi].skill ? i : bi), 0);
        if (MerchantHouses.openPost(player, world, tile, best).success) count(stats, 'postsOpened');
        post = MerchantHouses.postAt(player, tile.q, tile.r);
    }
    if (post) {
        if (!post.factor) {
            if (MerchantHouses.replaceFactor(player, world, post.id, 0).success) count(stats, 'factorsHired');
        } else if (post.suspicion >= 12 && MerchantHouses.audit(player, world, post.id).success) {
            count(stats, 'audits');
        }
        // (no local buy-low/sell-high order: a factor sells at what the player
        // would, about 0.7 of the ask, so a round trip in one market only
        // loses. The company earns on routes between its posts: below.)
        if (Utils.random() < 0.1) {
            const id = Utils.randPick(Object.keys(player.inventory || {}));
            if (id && MerchantHouses.depositStock(player, world, post.id, id, 5).success) {
                count(stats, 'stockDeposited');
                // ...and let the factor sell it off
                if (!post.orders.some(o => o.good === id) && post.orders.length < 4
                    && MerchantHouses.setOrder(player, post.id, { good: id, buyBelow: 0, buyQty: 0, sellAbove: 1, sellQty: 10, keep: 0 }).success) count(stats, 'ordersSet');
            }
        }
        if (Utils.random() < 0.05 && c.capital > 2000) {
            const order = post.orders[0];
            if (order && MerchantHouses.lobbyMonopoly(player, world, post.id, order.good).success) count(stats, 'lobbied');
        }
    }
    // Routes: buy where a good is cheap at one post, carry it to a post that pays more
    companyRoutes(game, c, stats);
    // Contracts: take one, buy its good at a post that sells it, send it on
    const m = MerchantHouses.state(player);
    // ...one a post can buy the goods for, cheaper than it pays
    const supplied = (ct) => ct.deadline - world.day >= 15 && c.posts.some(p => {
        if (!p.factor) return false;
        const t = world.getTile(p.q, p.r);
        const unit = MerchantHouses.factorBuyUnit(player, world, t, ct.good);
        const entry = unit && Trading.getAvailableGoods(t.settlement, t, world).find(g => g.id === ct.good);
        return entry && unit < ct.pay && entry.quantity >= ct.qty / 2 && c.capital > unit * ct.qty;
    });
    const offer = m.board.find(supplied);
    if (c.contracts.length < 2 && offer && Utils.random() < 0.5) {
        if (MerchantHouses.acceptContract(player, world, offer.id).success) count(stats, 'contractsAccepted');
    }
    for (const ct of c.contracts) {
        for (const opt of MerchantHouses.deliveryOptions(player, world, ct.id)) {
            if (MerchantHouses.deliverContract(player, world, ct.id, opt.from, { shipId: opt.shipId }).success) count(stats, 'contractDeliveries');
        }
        if (ct.status !== 'accepted') continue;
        for (const p of c.posts) {
            if ((p.stock[ct.good] || 0) > 0) {
                if (MerchantHouses.dispatchConvoy(player, world, p.id, { contractId: ct.id }, ct.good, p.stock[ct.good]).success) count(stats, 'convoys');
                continue;
            }
            const t = world.getTile(p.q, p.r);
            const unit = MerchantHouses.factorBuyUnit(player, world, t, ct.good);
            if (p.factor && unit && unit < ct.pay) {
                // Buy only what the contract still needs
                const held = c.posts.reduce((a, x) => a + (x.stock[ct.good] || 0), 0)
                    + c.convoys.filter(v => v.contractId === ct.id).reduce((a, v) => a + v.qty, 0);
                const need = Math.max(0, ct.qty - ct.delivered - held);
                if (p.orders.length >= 4 && !p.orders.some(o => o.good === ct.good)) p.orders.shift();
                if (MerchantHouses.setOrder(player, p.id, { good: ct.good, buyBelow: unit + 2, buyQty: need, sellAbove: 9999, sellQty: 0, keep: 0 }).success) count(stats, 'ordersSet');
                break;
            }
        }
    }
    // Stock bought for a contract that's gone: let the factor sell it (a route's buying end is kept)
    const routed = (p, good) => (game.companyRoutes || []).some(rt => rt.from === p.id && rt.good === good);
    for (const p of c.posts) {
        for (const o of p.orders) {
            if (o.sellQty === 0 && !routed(p, o.good) && !c.contracts.some(ct => ct.good === o.good)) Object.assign(o, { buyQty: 0, sellQty: 20, sellAbove: 1 });
        }
    }
    // Draw profits, top up a starved company, invest a little
    if (c.capital > 6000) { if (MerchantHouses.withdraw(player, world, 1500).success) count(stats, 'companyDrawn'); }
    else if (c.capital < 1000 && player.gold > 3000 && MerchantHouses.deposit(player, world, 1500).success) count(stats, 'companyFunded');
    if (m.ventures.length && c.capital > 1500 && Utils.random() < 0.1) {
        const v = Utils.randPick(m.ventures);
        if (MerchantHouses.invest(player, world, v.id, Math.min(v.maxStake, Math.floor(c.capital * 0.1))).success) count(stats, 'ventureStakes');
    }
    const rival = Utils.randPick(MerchantHouses.activeRivals(player));
    if (rival && c.capital > 2500 && Utils.random() < 0.05) {
        if (rival.shares.player >= 51 && MerchantHouses.buyOut(player, world, rival.id).success) count(stats, 'buyouts');
        else if (MerchantHouses.buyShares(player, world, rival.id, 5).success) count(stats, 'sharesBought');
    }
    if (rival && rival.shares.player > 0 && Utils.random() < 0.02 && MerchantHouses.sellShares(player, world, rival.id, rival.shares.player).success) count(stats, 'sharesSold');
}

/**
 * The company's trade routes, as a sensible owner runs them: a buying order
 * at the post where a good is cheap, a selling order at the post that pays
 * enough more to cover the convoy, and the convoys between them. Routes are
 * re-planned now and then from the posts' own markets; a route whose margin
 * has gone is dropped (its stock is sold where it lies).
 */
function companyRoutes(game, c, stats) {
    const { player, world } = game;
    const posts = c.posts.filter(p => p.factor);
    const byId = (id) => posts.find(p => p.id === id);
    let routes = (game.companyRoutes || []).filter(rt => byId(rt.from) && byId(rt.to));
    // Ship what the buying post holds once there is a load worth the carriage
    for (const rt of routes) {
        const from = byId(rt.from);
        const have = Math.floor(from.stock[rt.good] || 0);
        if (have >= 15 && MerchantHouses.dispatchConvoy(player, world, from.id, { postId: rt.to }, rt.good, have).success) count(stats, 'routeConvoys');
    }
    if (posts.length < 2 || (routes.length && Utils.random() > 0.08)) { game.companyRoutes = routes; return; }
    // Re-plan: the best margins between the posts' markets, after the carriage
    const cands = MerchantHouses.routeIdeas(player, world, { limit: 12 }).map(r => ({ from: r.fromPostId, to: r.toPostId, good: r.good, unit: r.unit }));
    const keep = [];
    for (const cd of cands) {
        if (keep.length >= 2) break;
        if (keep.some(k => k.from === cd.from || k.good === cd.good)) continue;
        keep.push(cd);
    }
    // Old routes not kept: the buying stops, what is left sells where it lies
    for (const rt of routes) {
        if (keep.some(k => k.from === rt.from && k.to === rt.to && k.good === rt.good)) continue;
        const from = byId(rt.from);
        const o = from && from.orders.find(x => x.good === rt.good);
        if (o) Object.assign(o, { buyQty: 0, sellQty: 20, sellAbove: 1 });
    }
    for (const k of keep) {
        const from = byId(k.from), to = byId(k.to);
        if (from.orders.length >= 4 && !from.orders.some(o => o.good === k.good)) from.orders.shift();
        if (to.orders.length >= 4 && !to.orders.some(o => o.good === k.good)) to.orders.shift();
        if (MerchantHouses.setOrder(player, from.id, { good: k.good, buyBelow: Math.ceil(k.unit * 1.03), buyQty: 40, sellAbove: 9999, sellQty: 0, keep: 0 }).success
            && MerchantHouses.setOrder(player, to.id, { good: k.good, buyBelow: 0, buyQty: 0, sellAbove: Math.ceil(k.unit * 1.08), sellQty: 40, keep: 0 }).success) {
            count(stats, 'routesPlanned');
            count(stats, 'ordersSet', 2);
        }
    }
    game.companyRoutes = keep.map(k => ({ from: k.from, to: k.to, good: k.good }));
}

function ships(game, tile, stats) {
    const { player, world } = game;
    if (!Ships.isPortTile(world, tile.q, tile.r)) return;
    const own = (player.ships || []).filter(s => s.status === 'docked' && s.q === tile.q && s.r === tile.r);
    if (!(player.ships || []).length && player.gold > 2500) {
        const used = Ships.getUsedShipsForSale(tile);
        const i = used.findIndex(u => u.price < player.gold * 0.5);
        if (i >= 0 && Ships.buyUsedShip(player, world, tile.q, tile.r, i).success) count(stats, 'shipsBought');
    }
    for (const ship of (player.ships || []).filter(s => s.status === 'docked' && s.q === tile.q && s.r === tile.r)) {
        if (Ships.hireCrew(player, world, ship.id).success) count(stats, 'crewHired');
    }
    // Port trade: buy an export, sell it at the next port of call
    for (const ship of own) {
        const market = Ships.getPortMarket(world, tile.q, tile.r);
        for (const [good, qty] of Object.entries({ ...(ship.cargo || {}) })) {
            if (market.some(e => e.id === good) && Ships.sellTradeGood(player, world, ship.id, good, qty).success) count(stats, 'portSales');
        }
        const exp = market.filter(e => e.role === 'export' && e.buy);
        if (exp.length && player.gold > 1500 && Utils.random() < 0.6) {
            const e = Utils.randPick(exp);
            // ...leaving room in the hold for the provisions of a voyage
            const room = Math.min(10, Ships.getCargoFree(ship) - 15);
            if (room > 0 && Ships.buyTradeGood(player, world, ship.id, e.id, room).success) count(stats, 'portBuys');
        }
    }
}

/** Board, put out to open water, explore / hunt pirates / turn pirate, come back in. */
function seaActivity(game, tile, stats) {
    const { player, world } = game;
    if (!Ships.isPortTile(world, tile.q, tile.r) || Utils.random() > 0.2) return;
    const ship = (player.ships || []).find(s => s.status === 'docked' && s.q === tile.q && s.r === tile.r && !Ships.crewSailReason(s));
    if (!ship || !Ships.boardShip(player, ship.id).success) return;
    const water = Hex.neighbors(tile.q, tile.r)
        .map(n => ({ q: Hex.wrapQ(n.q, world.width), r: n.r }))
        .find(n => n.r >= 0 && n.r < world.height && Ships.isWaterTile(world.getTile(n.q, n.r)));
    if (water) travelTo(game, water.q, water.r);
    // Now and then row ashore on open coast and run anything that owes duty past the customs house (systems/landings.js)
    // (decided by a hash of the day, so the bot's own dice are not shifted)
    if (water && (Utils.hashStr(`beachRun:${world.day}`) >>> 0) % 10 < 3) beachRun(game, ship, stats);
    const act = Utils.random() < 0.1 ? 'commitPiracy' : Utils.randPick(['exploreOcean', 'huntPirates']);
    // Exploring can turn up an uncharted place (systems/discovery.js), as in the ship menu
    const res = act === 'exploreOcean' ? Discovery.exploreOcean(player, ship.id, world) : Ships[act](player, ship.id, world);
    if (res && res.discovery) count(stats, 'discoveredExploring');
    if (res && res.success) count(stats, `sea_${act}`);
    travelTo(game, tile.q, tile.r);
    if (Ships.disembark(player, world).success) count(stats, 'disembarked');
}

/** Row ashore on open coast beside the ship, run a boat-load of whatever owes duty past the customs, row back out. */
function beachRun(game, ship, stats) {
    const { player, world } = game;
    const shore = Ships.getRowAshoreTargets(world, player.q, player.r).find(t => !t.settlement && !Ships.hasDock(world, t.q, t.r));
    if (!shore || !Ships.rowAshore(player, world, shore.q, shore.r).success) return;
    count(stats, 'beachLandings');
    for (const o of Landings.runOptions(player, world)) {
        if (!o.ok) continue;
        const res = Landings.runAshore(player, world, o.shipId, o.goodId);
        if (res.success) count(stats, res.caught ? 'beachRunsCaught' : 'beachRuns');
        break;
    }
    // The landed goods stay in the packs (they sell duty-free now); the bot rows back out
    if (!player.jailState) Ships.rowToShip(player, ship.id);
}

/** Plan and pull a heist once the guild trusts the bot with one. */
function heist(game, tile, stats) {
    const { player, world } = game;
    const st = Underworld.ensure(player);
    if (!st.guild.member) return;
    if (!st.heist) {
        const target = Underworld.heistTargets(tile.settlement)[0];
        if (target && Utils.random() < 0.3 && Underworld.startHeist(player, world, tile, target.id).success) count(stats, 'heistsPlanned');
        return;
    }
    const plan = Underworld.heistPlan(player);
    if (!plan || plan.key !== `${tile.q},${tile.r}`) return;
    for (const step of plan.open) {
        if (Underworld.planStep(player, world, tile, step.id).success) count(stats, 'heistSteps');
    }
    const res = Underworld.executeHeist(player, world, tile);
    if (res.success) count(stats, `heist_${res.outcome}`);
}

function sail(game, tile, stats) {
    const { player, world } = game;
    // (come back to the ship to sail — a town over the water wanted: chooseDestination — it sails the day it arrives)
    const keen = !!(game.dest && game.dest.ship && game.dest.q === tile.q && game.dest.r === tile.r);
    if (!Ships.isPortTile(world, tile.q, tile.r) || (!keen && Utils.random() > 0.25)) return false;
    const ship = (player.ships || []).find(s => s.status === 'docked' && s.q === tile.q && s.r === tile.r && !Ships.crewSailReason(s));
    if (!ship) return false;
    const ports = settlementTiles(world).filter(t => Ships.isPortTile(world, t.q, t.r));
    const dest = nearest(world, tile, ports, 5);
    if (!dest.length) return false;
    // A port picked at random, else the nearest the ship can reach and be victualled for
    const first = Utils.randPick(dest);
    for (const d of [first, ...dest.filter(x => x !== first)]) {
        const dTile = world.getTile(d.q, d.r);
        const route = Ships.seaPath(world, tile, d);
        if (!route || !dTile || !dTile.settlement) continue;
        // Victual the ship for the passage, with a few days in hand
        const voyageDays = Ships.voyageDays(player, ship, route.length) + 3;
        const want = Ships.provisionsNeeded(ship, voyageDays, { player });
        // A hold full of trade goods: sell what this port takes to make room for food
        if (want > Ships.getCargoFree(ship)) {
            const market = Ships.getPortMarket(world, tile.q, tile.r);
            for (const [good, qty] of Object.entries({ ...(ship.cargo || {}) })) {
                if (market.some(e => e.id === good) && Ships.sellTradeGood(player, world, ship.id, good, qty).success) count(stats, 'portSales');
            }
        }
        if (want > 0 && Ships.buyProvisions(player, world, ship.id, want).success) count(stats, 'provisioned');
        if (Ships.provisionsNeeded(ship, voyageDays, { player }) > 0) { count(stats, 'voyageUnvictualled'); continue; }
        const res = Ships.sailPlayerTo(player, ship.id, d.q, d.r, dTile.settlement.name, world);
        if (res.success) { count(stats, 'voyages'); return true; }
    }
    return false;
}

/**
 * An expedition from a port (systems/discovery.js): read the notice board
 * for rumours of uncharted land, victual, and sail for the rumour — or for
 * the open sea far from every port.
 */
function expedition(game, tile, stats) {
    const { player, world } = game;
    if (!Ships.isPortTile(world, tile.q, tile.r) || player.gold < 300 || Utils.random() > 0.1) return false;
    const ship = (player.ships || []).find(s => s.status === 'docked' && s.q === tile.q && s.r === tile.r && !Ships.crewSailReason(s));
    if (!ship) return false;
    count(stats, 'discoveryRumours', Discovery.tavernRumors(player, world, tile).length);
    const targets = Discovery.expeditionTargets(player, world, ship);
    const t = targets.find(x => x.siteId) || targets.find(x => x.id === 'open');
    if (!t) return false;
    const days = Ships.voyageDays(player, ship, t.leagues) * 2 + 3;
    const want = Ships.provisionsNeeded(ship, days, { player });
    if (want > 0) {
        let pr = Ships.buyProvisions(player, world, ship.id, want);
        // A hold full of unsold cargo: take it into the packs to make room for victuals
        if (!pr.success && Ships.getCargoFree(ship) <= 0) {
            for (const item of Object.keys(ship.cargo || {})) {
                if (Ships.getCargoFree(ship) > 0) break;
                if (Ships.unloadToPlayer(player, world, ship.id, item).success) count(stats, 'holdCleared');
            }
            pr = Ships.buyProvisions(player, world, ship.id, want);
        }
        if (pr.success) count(stats, 'provisioned');
    }
    // Heed the chandler's warning: no expedition without food for the way back
    if (Ships.provisionsNeeded(ship, days, { player }) > 0) { count(stats, 'expeditionUnvictualled'); return false; }
    if (!Discovery.startExpedition(player, world, ship.id, t.id).success) return false;
    count(stats, 'expeditions');
    return true;
}

/** Uncharted lands found: name them, gather their goods, sometimes sell the chart. */
function discoveries(game, stats) {
    const { player, world } = game;
    for (const site of Discovery.sites(player)) {
        if (site.naming && Discovery.nameSite(player, world, site.id, site.nameOptions[1] || null).success) count(stats, 'discoveriesNamed');
        // Leave a realm's claimed land alone unless it already thinks well of you: poaching costs reputation
        const claimedBy = site.claim && site.claim.by !== 'player' ? site.claim.by : null;
        if (claimedBy && ((player.reputation || {})[claimedBy] || 0) < 20) { count(stats, 'claimedSitesSpared'); continue; }
        if (!Discovery.gatherReason(player, world, site) && Discovery.gather(player, world, site.id).success) count(stats, 'exoticGathered');
        if (!Discovery.archiveOffer(player, world, site).reason && Utils.random() < 0.3
            && Discovery.sellToArchive(player, world, site.id).success) count(stats, 'chartsSold');
    }
}

/**
 * Answer the sea's holds on the ship aboard: a patrol that has brought her to
 * (systems/seaInterception.js — outsail them when the odds are fair, fight
 * when she is a match, else strike) and a blockade she lies off
 * (systems/blockadeRunning.js — run it by dark, else turn back).
 */
function seaHolds(game, stats) {
    const { player, world } = game;
    let st = SeaInterception.pending(player) ? SeaInterception.start(player, world) : null;
    for (let i = 0; st && i < 3; i++) {
        const view = SeaInterception.view(player, world, st);
        if (!view) break;
        const flee = view.options.find(o => o.id === 'flee');
        const ship = Ships.getShipById(player, st.shipId);
        const own = ship ? Ships._getShipCombatStrength(ship, player) : 0;
        const pick = flee && flee.chance >= 0.45 ? 'flee' : own >= st.strength * 0.7 ? 'fight' : 'strike';
        const out = SeaInterception.act(player, world, st, pick);
        count(stats, `intercept_${pick}`);
        st = out && out.state ? out.state : null;
    }
    let bl = BlockadeRunning.pending(player) ? BlockadeRunning.start(player, world) : null;
    for (let i = 0; bl && i < 3; i++) {
        const pick = bl.phase === 'caught' ? 'strike' : (BlockadeRunning.odds(player, world, bl, true).chance >= 0.4 ? 'run_night' : 'turn_back');
        const out = BlockadeRunning.act(player, world, bl, pick);
        count(stats, `blockade_${pick}`);
        bl = out && out.state ? out.state : null;
    }
}

/** A day at sea on a voyage: answer any event, sometimes heave to. */
function voyageDay(game, stats) {
    const { player, world } = game;
    seaHolds(game, stats);
    if (!Ships.getVoyage(player)) return;
    if (player.needs && player.needs.hunger < 60 && player.getFoodCount() > 0) player.eatMeal();
    const ev = Ships.describeVoyageEvent(player);
    if (ev) {
        const open = ev.choices.filter(c => c.available);
        const pick = open.length && Utils.random() < 0.8 ? Utils.randPick(open).id : null;
        const res = Ships.resolveVoyageEvent(player, world, pick);
        if (res.success) count(stats, pick ? 'voyageEventsAnswered' : 'voyageEventsDefaulted');
    }
    if (Utils.random() < 0.01 && Ships.heaveTo(player, world).success) count(stats, 'heaveTo');
    count(stats, 'daysAtSea');
}

function throne(game, stats) {
    const { player, world } = game;
    const armyStrength = PlayerMilitary.getArmyStrength(player);
    const st = Throne.state(player);
    if (st.civilWar) {
        // Meet the loyalists in the field
        // (once the loyalists have fielded a fresh vanguard: one broken sooner counts for little — Throne.recordThroneBattle)
        const rested = !Number.isFinite(st.civilWar.lastVanguardDay) || world.day - st.civilWar.lastVanguardDay >= (Throne.config().civilWar.vanguardRestDays || 0);
        if (armyStrength > 0 && rested && Utils.random() < 0.4) {
            const k = world.getKingdom(st.civilWar.kingdomId);
            const t = world.getTile(player.q, player.r);
            const battle = PlayerMilitary.combat(player, Throne.loyalistVanguard(player, world), `${k ? k.name : 'Crown'} loyalists`,
                { world, terrainId: t && t.terrain && t.terrain.id });
            if (!battle.reason && Throne.recordThroneBattle(player, world, battle.victory).success) count(stats, 'throneBattles');
        }
        return;
    }
    if (st.ruling) {
        // Rule like a sensible monarch: light taxes while the realm is restless
        // (a restless realm pays the levy little: Throne.levyQuote), standard
        // once it settles; seek peace when the crown runs short; now and then
        // try the faith policy
        const k = Throne.ruledKingdom(player, world);
        if (k && Utils.random() < 0.1) {
            const stab = typeof k.stability === 'number' ? k.stability : 60;
            const tax = stab < 45 ? 'light' : stab > 70 ? 'standard' : st.ruling.policies.tax === 'heavy' ? 'standard' : st.ruling.policies.tax;
            if (tax !== st.ruling.policies.tax && Throne.setPolicy(player, world, 'tax', tax).success) count(stats, 'policiesSet');
            const short = Throne.levyQuote(player, world, k).limit === 'surplus' || (k.wars || []).length > 1;
            const stance = short ? 'peace' : 'defensive';
            if (stance !== st.ruling.policies.stance && Throne.setPolicy(player, world, 'stance', stance).success) count(stats, 'policiesSet');
            if (Utils.random() < 0.2) {
                const opts = Object.keys((Throne.policies().faith || {}).options || {});
                if (opts.length && Throne.setPolicy(player, world, 'faith', Utils.randPick(opts)).success) count(stats, 'policiesSet');
            }
        }
        royalCourt(game, stats);
        return;
    }
    // A royal match for a claim by marriage
    if (!player.spouse && player.gold > 3000 && Utils.random() < 0.05) {
        const target = Throne.claimableKingdoms(player, world)[0];
        if (target && Throne.arrangeRoyalMatch(player, world, target.id).success) count(stats, 'royalMatches');
    }
    const kingdoms = Throne.claimableKingdoms(player, world);
    if (!kingdoms.length) return;
    // Stick to one target realm once chosen
    let k = game.claimTarget && kingdoms.find(x => x.id === game.claimTarget);
    if (!k) {
        k = kingdoms.reduce((a, b) => ((player.reputation || {})[b.id] || 0) > ((player.reputation || {})[a.id] || 0) ? b : a);
        game.claimTarget = k.id;
    }
    if (Throne.purchaseClaim(player, world, k.id).success) count(stats, 'claimsBought');
    // Spies cost wages every day: let them go once the claim is made, or when money is short
    if (player.espionage && player.espionage.spies.length && (player.gold < 1500 || Throne.claimStrength(player, k.id) >= 30)) {
        for (const spy of player.espionage.spies.slice()) {
            if (Espionage.dismissSpy(player, spy.id).success) count(stats, 'spiesDismissed');
        }
    }
    // A spy to forge genealogies, once there is money for it
    if (player.gold > 6000 && Throne.claimStrength(player, k.id) < 30) {
        Espionage.initPlayer(player);
        if (!player.espionage.spies.length) {
            const spy = Espionage.generateSpy(player, world);
            if (Espionage.recruitSpy(player, spy, world).success) count(stats, 'spiesHired');
        }
        const forged = Throne.forgeClaim(player, world, k.id);
        if (forged.success) count(stats, forged.failed ? 'forgeriesExposed' : 'claimsForged');
    }
    if (Throne.canPress(player, world, k.id, { armyStrength }).ok) {
        if (Throne.pressClaim(player, world, k.id, { armyStrength }).success) count(stats, 'claimsPressed');
    }
}

/** Rule the realm's court: fill the council, proclaim an edict, answer factions and revolts. */
function royalCourt(game, stats) {
    const { player, world } = game;
    const court = Kingship.court(player);
    if (!court || !court.initialized) return;
    // (the Marshal first: the host fights by him — Kingship.battleEffect)
    for (const office of ['marshal', ...Kingship.OFFICES.filter(o => o !== 'marshal')]) {
        if (court.council[office]) continue;
        const best = Kingship.candidates(player, world, office).find(c => !c.office);
        if (best && Kingship.appoint(player, world, office, best.kind, best.id).success) count(stats, 'councilAppointed');
    }
    // ...and a far better soldier than the sitting Marshal takes his place
    const marshal = Kingship.councillor(player, world, 'marshal');
    if (marshal && world.day % 30 === 0) {
        const better = Kingship.candidates(player, world, 'marshal').find(c => !c.office && c.score >= marshal.competence * Kingship._loyaltyFactor(marshal.loyalty) + 4);
        if (better && Kingship.appoint(player, world, 'marshal', better.kind, better.id).success) count(stats, 'marshalReplaced');
    }
    // The crown's books (systems/fiscal.js): the ruler leaves taxes, the court and
    // the army's pay to the treasurers (Fiscal._review reviews the ruled realm as it
    // does an AI crown's, within ruledMaxTax), so the soak measures a hands-off
    // ruler. Only in a real crisis — the realm near revolt under heavy taxes — does
    // the ruler take the taxes in hand and ease them, handing them back once calm.
    // (Before 2026-11-24 the bot set every lever by days of spending alone, which
    // held the realm at heavy taxes for good and overruled the treasurers.)
    const ruled = Throne.ruledKingdom(player, world);
    if (ruled && world.day % 7 === 0) {
        const f = CrownBooks.state(ruled);
        const manual = f.manual || {};
        const stab = typeof ruled.stability === 'number' ? ruled.stability : 60;
        const crisis = !manual.tax && stab < 20 && ['heavy', 'crushing'].includes(f.level);
        if (crisis) {
            if (Fiscal.setRate(player, world, 'all', 'standard').success) count(stats, 'crownTaxSet');
        } else if (manual.tax && stab > 40) {
            if (Fiscal.setRate(player, world, 'all', 'auto').success) count(stats, 'crownTaxAuto');
        }
        if (manual.court && Fiscal.setCourt(player, world, 'auto').success) count(stats, 'crownCourtAuto');
        if (manual.army && Fiscal.setArmyPay(player, world, 'auto').success) count(stats, 'crownPayAuto');
    }
    // (edicts only from a treasury with a cushion: their upkeep is the crown's, every day)
    const realm = Throne.ruledKingdom(player, world);
    // (and from chests a season deep: passed on a thin cushion and repealed when it ran out, the
    // edicts came and went a hundred times a run, the factions stirred by each)
    if (Utils.random() < 0.1 && realm && (realm.treasury || 0) > Throne.levyQuote(player, world, realm).reserve * 2 && Fiscal.reserveDays(realm) >= 45) {
        const open = Object.keys(Kingship.edicts()).filter(id => Kingship.canPass(player, world, id).ok);
        if (open.length && Kingship.passEdict(player, world, Utils.randPick(open)).success) count(stats, 'edictsPassed');
    }
    for (const f of Kingship.factions(player, world, { revealedOnly: true })) {
        if (!f.faction.ultimatum) continue;
        const res = Utils.random() < 0.5 ? Kingship.arrestLeader(player, world, f.faction.id) : { success: false };
        if (res.success) count(stats, 'factionLeadersArrested');
        else if (Kingship.concede(player, world, f.faction.id).success) count(stats, 'factionsConceded');
    }
    if (ruled && world.day % 7 === 2) foreignAffairs(game, stats, ruled);
    if (court.revolt && Utils.random() < 0.05 && Kingship.parley(player, world).success) count(stats, 'revoltParleys');
    if (Utils.random() < 0.03 && Kingship.holdFeast(player, world).success) count(stats, 'royalFeasts');
    const unhappy = court.vassals.find(v => !v.rebel && v.opinion < -20);
    if (unhappy && Utils.random() < 0.05 && Kingship.grantGold(player, world, unhappy.id).success) count(stats, 'vassalGrants');
}

/**
 * The crown's foreign affairs, weekly, as a careful ruler keeps them (the
 * levers are the ruler's alone: a ruled realm's court sends no envoys of its
 * own — KingdomAI.considerDiplomacy — and signs no alliance unbidden):
 *  - a war going badly (the enemy's host outweighs ours) is ended by envoys
 *    (Throne.proposePeace, its own odds and cooldown);
 *  - a neighbour that hates us and is not yet at war is sent gifts when the
 *    chests can spare them (Throne.sendRoyalGifts) — every war leaves the
 *    enemy's regard at −40, below where a court marches again (KingdomAI
 *    considerWar: −30), so a crown that never mends fences fights the same
 *    realms over and over;
 *  - a realm warm enough is made an ally (Throne.proposeAlliance; allies are
 *    never marched on);
 *  - the edicts are repealed when the chests run low (their upkeep is daily).
 * (Before 2026-11-24 the bot did none of this: its realm was at war two days
 * in three, against the AI realms' one in five.)
 */
function foreignAffairs(game, stats, k) {
    const { player, world } = game;
    const others = world.kingdoms.filter(o => o && o.isAlive && o.id !== k.id);
    const ours = Math.max(1, k.military || 0) + PlayerMilitary.getArmyStrength(player);
    // Sue for peace in a war going badly (never a sworn one: Throne.proposePeace refuses it)
    for (const eid of (k.wars || []).slice()) {
        const e = others.find(o => o.id === eid);
        if (!e || (e.military || 0) < ours * 1.1) continue;
        const r = Throne.proposePeace(player, world, eid);
        if (r.success) count(stats, r.failed ? 'peaceRefused' : 'peaceMade');
    }
    const reserve = Fiscal.reserveDays(k);
    // Gifts to the most hostile neighbour at peace (its own regard of us is what moves its court)
    // (to a neighbour strong enough to be a danger: gifts cost less than a war)
    const giftCost = Throne.config().ruling.giftCost || 300;
    if (reserve >= 20 && (k.treasury || 0) >= giftCost * 4) {
        const might = (o) => (o.military || 0) + (o.population || 0) * 0.1;
        const near = (o) => k.capital && o.capital && Hex.wrappingDistance(k.capital.q, k.capital.r, o.capital.q, o.capital.r, world.width) <= 28;
        const foe = others.filter(o => near(o) && !(k.wars || []).includes(o.id) && ((o.relations || {})[k.id] || 0) < -25 && might(o) >= might(k) * 0.6)
            .sort((a, b) => ((a.relations || {})[k.id] || 0) - ((b.relations || {})[k.id] || 0))[0];
        if (foe && Throne.sendRoyalGifts(player, world, foe.id).success) count(stats, 'royalGifts');
    }
    // An ally where the regard runs warm both ways (two at most)
    // (a realm weaker than its neighbours on average takes every friend it can get, up to four:
    // allies never march on each other, and the AI realms, allied six and eight deep among
    // themselves, left the small realm outside every pact the one they marched on)
    const mightOf = (o) => (o.military || 0) + (o.population || 0) * 0.1;
    const avgMight = others.length ? others.reduce((t, o) => t + mightOf(o), 0) / others.length : 0;
    if ((k.allies || []).length < (mightOf(k) < avgMight ? 4 : 2)) {
        const min = Throne.config().ruling.allianceMinRelations || 40;
        const friend = others.find(o => !(k.wars || []).includes(o.id) && !(k.allies || []).includes(o.id)
            && Math.min((k.relations || {})[o.id] || 0, (o.relations || {})[k.id] || 0) >= min);
        if (friend && Throne.proposeAlliance(player, world, friend.id).success) count(stats, 'alliancesMade');
    }
    // The edicts cost the crown daily: repealed when the chests run low
    const court = Kingship.court(player);
    if (court && reserve < 15 && world.day - (game.lastRepeal || -1e9) >= 30) {
        for (const id of Object.keys(court.edicts || {})) {
            if (Kingship.revokeEdict(player, world, id).success) { count(stats, 'edictsRepealed'); game.lastRepeal = world.day; }
            break;
        }
    }
}

function treasures(game, stats) {
    const { player, world } = game;
    for (const t of Treasures.held(player)) {
        const id = t.id;
        const tr = t.info;
        if (tr.consume && player.health < 60 && Treasures.use(player, id).success) count(stats, 'treasureUsed');
        else if (tr.prestige && Utils.random() < 0.2 && Treasures.dedicate(player, id, world.day).success) count(stats, 'treasureDedicated');
    }
}

/** Patronage & Great Works: keep a couple of clients busy and raise a work once rich. */
function patronage(game, tile, stats) {
    const { player, world } = game;
    const st = Patronage.state(player);
    for (const o of st.offers.slice()) {
        const answer = player.gold > o.counter * 4 ? 'match' : 'release';
        if (Patronage.answerOffer(player, world, o.clientId, answer).success) count(stats, `patronOffer_${answer}`);
    }
    if (player.gold > 6000 && st.clients.length < 2) {
        const cand = Patronage.salon(player, world, tile)[0];
        if (cand && Patronage.hire(player, world, tile, cand.id).success) count(stats, 'clientsHired');
    }
    for (const c of st.clients) {
        if (c.task || c.assignedTo) continue;
        if (c.profession === 'architect') {
            const p = st.projects[0];
            if (p && Patronage.assignArchitect(player, world, c.id, p.id).success) count(stats, 'architectsAssigned');
            continue;
        }
        const workId = (Patronage.professions()[c.profession] || {}).works?.[0];
        if (workId && player.gold > 2500 && Patronage.commission(player, world, c.id, workId).success) count(stats, 'commissions');
    }
    for (const g of st.gallery.filter(x => !x.donatedTo)) {
        if (Patronage.donate(player, world, tile, g.uid).success) count(stats, 'worksDonated');
    }
    // A Great Work is a fortune sunk: not on borrowed money (seed 404's bot
    // took a great loan, raised a work with it and starved repaying it)
    if (player.gold > 8000 && !st.projects.length && !Finance.state(player).loans.length) {
        for (const id of Object.keys(Patronage.greatWorks())) {
            if (Patronage.found(player, world, tile.q, tile.r, id).success) { count(stats, 'greatWorksBegun'); break; }
        }
    }
    for (const p of st.projects) {
        if (p.status === 'supplying' && player.gold > 4000 && Patronage.deliver(player, world, p.id, { buyMissing: true }).success) count(stats, 'greatWorkDeliveries');
    }
}

/** Banks, Credit & Coin: park surplus gold, borrow now and then, buy a royal bond when rich. */
function banking(game, tile, stats) {
    const { player, world } = game;
    const st = Finance.state(player);
    // Pay off a loan early once flush
    for (const l of st.loans.slice()) {
        if (player.gold > Math.ceil(l.totalOwed) * 3 && Finance.repayLoan(player, world, l.id).success) count(stats, 'loansRepaid');
    }
    const here = Finance.banksAt(player, world, tile);
    if (!here.length) return;
    const bank = here[0];
    const acct = st.accounts[bank.id];
    // Save like a sensible player: a quarter of what sits above a working
    // purse goes to the bank (out of the cutpurses' and schemers' reach, earning)
    // (a larger working purse until the trading company is founded: it wants 3,500)
    // Saving for the company (companyTarget): all but a bread purse goes in
    const saving = savingNow(game);
    const SAVE_ABOVE = saving ? 300 : MerchantHouses.company(player) ? 2500 : 6000;
    if (player.gold > SAVE_ABOVE + (saving ? 100 : 400) && Finance.deposit(player, world, bank.id, Math.floor((player.gold - SAVE_ABOVE) * (saving ? 1 : 0.25))).success) count(stats, saving ? 'savedForCompany' : 'deposits');
    else if (player.gold < 300 && acct && acct.balance >= 100 && Finance.withdraw(player, world, bank.id, 500).success) count(stats, 'withdrawals');
    // Not saving for the company: a merchant's working purse drawn back from the bank — the trade,
    // a guild's fee, a lease, an estate or a few shares want coin in hand (it deposits only above 2,900)
    else if (!saving && player.gold < 1500 && acct && acct.balance >= 500 && Finance.withdraw(player, world, bank.id, Math.floor(Math.min(acct.balance, 2500 - player.gold))).success) count(stats, 'workingPurseDrawn');
    // Borrow modestly, and only with money in hand to carry the payments: a
    // great loan taken by a near-broke bot drained it to nothing (seed 404)
    if (!st.loans.length && player.gold > 2000 && Utils.random() < 0.05) {
        const offer = Finance.loanOffers(player, world, bank.id).filter(o => o.available && o.amount <= player.gold / 2).pop();
        if (offer && Finance.takeLoan(player, world, bank.id, offer.id).success) count(stats, `loan_${offer.id}`);
    }
    if (player.gold > 12000 && Utils.random() < 0.05) {
        const o = Finance.bondOffers(player, world).find(x => x.room >= 1000);
        if (o && Finance.buyBond(player, world, o.kingdomId, 1000).success) count(stats, 'bondsBought');
    }
}

/** Buy what's missing of `materials` ({ goodId: n }) from the stalls here; true when all are in the packs. */
/** Underwriters: cover what is exposed while there's money to carry the premiums; drop it when broke. No dice. */
function insurance(game, tile, stats) {
    const { player, world } = game;
    for (const n of (game.underwritingDay && game.underwritingDay.notices) || []) if (n.title === 'Claim Paid') count(stats, 'claimsPaid');
    const here = Underwriting.underwritersAt(player, world, tile);
    for (const kind of COVER_KINDS) {
        const held = Underwriting.cover(player, kind);
        if (held && player.gold < 300) { if (Underwriting.cancelCover(player, world, kind).success) count(stats, 'coversCancelled'); continue; }
        if (held || !here.length || player.gold < 1500) continue;
        if (Underwriting.exposure(player, world, kind).length === 0 && !(kind === 'marine' && (player.ships || []).length)) continue;
        const uw = here.find(u => !Underwriting.banned(player, u.id, world.day));
        if (uw && Underwriting.openCover(player, world, uw.id, kind).success) count(stats, 'coversOpened');
    }
}

/** Bills of exchange: carry a fortune as paper, and cash it where the paying house serves. */
function bills(game, tile, stats) {
    const { player, world } = game;
    const here = Finance.banksAt(player, world, tile);
    for (const b of Bills.held(player)) {
        if (b.status === 'stolen' && Bills.stop(player, world, b.id).success) count(stats, 'billsStopped');
        else if (b.status === 'held' && Bills.present(player, world, b.id).success) count(stats, 'billsPresented');
    }
    if (!here.length || player.gold < 12000 || Bills.held(player).length >= 2) return;
    const to = Bills.payees(player, here[0].id)[0];
    if (to && Bills.draw(player, world, here[0].id, to.id, 3000).success) count(stats, 'billsDrawn');
}

/** The Bourse: a few shares in the best-yielding houses and banks with money to spare (chooseDestination walks to an exchange); sell when short. No dice. */
function bourse(game, tile, stats) {
    const { player, world } = game;
    if (!Bourse.exchangeAt(player, world)) return;
    const held = Bourse.portfolio(player);
    if (player.gold < 600 && held.length) {
        const p = held[0];
        if (Bourse.sell(player, world, p.listing.id, p.shares).success) count(stats, 'sharesSoldBourse');
        return;
    }
    // (shares run from a few gold to a hundred: a purse of 1,500 can spare 600 for them)
    if (player.gold < 1500 || frugal(game) || Bourse.portfolioValue(player) > 2000) return;
    const pick = Bourse.listed(player).filter(l => (l.kind === 'house' || l.kind === 'bank') && l.price > 0)
        .sort((a, b) => b.lastDiv / b.price - a.lastDiv / a.price || a.id.localeCompare(b.id))[0];
    if (pick && Bourse.buy(player, world, pick.id, Math.max(1, Math.min(10, Math.floor(600 / pick.price)))).success) count(stats, 'sharesBoughtBourse');
}

function buyMaterials(game, tile, materials, stats) {
    const { player, world } = game;
    for (const [id, n] of Object.entries(materials)) {
        const short = n - (player.inventory[id] || 0);
        if (short <= 0) continue;
        const entry = Trading.getAvailableGoods(tile.settlement, tile, world).find(g => g.id === id);
        if (!entry || entry.quantity < short || Trading.buyCost(player, entry, short, tile.settlement) > player.gold - 500) return false;
        if (!Trading.buyGoods(player, entry, short, tile.settlement).success) return false;
        count(stats, 'materialsBought');
    }
    return true;
}

/** Merchant Prince: fund works in a big town, speculate on grain with a store-room, keep forward contracts. */
function merchantPrince(game, tile, stats) {
    const { player, world } = game;
    const s = tile.settlement;
    // Works: a bakehouse or brewhouse in a town of 1,000+ (the quote says if it's too small), while there's money to spare
    // (a works costs a few hundred gold and its materials: funded with 1,000 kept in hand)
    if (player.gold > 1500 && !founding(game) && (s.population || 0) >= 1000) {
        for (const id of ['bakery', 'brewery', 'charcoal', 'mill']) {
            const q = MerchantPrince.investQuote(player, world, tile, id);
            if (!q.lvl || q.lvl > 1 || !(q.margin && q.margin.perRun > 0) || player.gold < q.gold + 1000) continue;
            if (!buyMaterials(game, tile, q.materials, stats)) continue;
            if (MerchantPrince.invest(player, world, tile, id).success) { count(stats, 'worksFunded'); break; }
        }
    }
    for (const x of MerchantPrince.investments(player, world)) {
        if (x.repairCost > 0 && x.works && x.works.cond < 0.6 && player.gold > x.repairCost + 1000 && MerchantPrince.repair(player, world, x.inv.id).success) count(stats, 'worksRepaired');
    }
    // A store-room for grain: buy after the harvest, sell in the lean weeks
    const doy = Seasons.dayOfYear(world.day);
    let w = MerchantPrince.warehouseAt(player, tile.q, tile.r);
    if (!w && player.gold > 8000 && ['city', 'capital'].includes(s.type) && doy >= 80 && doy <= 95
        && MerchantPrince.state(player).warehouses.length < 2 && SettlementMarket.scarcity(s, 'grain') < 0.9) {
        if (MerchantPrince.rentWarehouse(player, world, tile, 'small').success) count(stats, 'warehousesRented');
        w = MerchantPrince.warehouseAt(player, tile.q, tile.r);
    }
    if (w) {
        if (doy >= 80 && doy <= 95 && SettlementMarket.scarcity(s, 'grain') < 0.9 && player.gold > 5000) {
            if (MerchantPrince.buyInto(player, world, w.id, 'grain', 60).success) count(stats, 'warehouseBuys');
        }
        for (const [id, qty] of Object.entries(w.goods)) {
            if (qty >= 1 && (SettlementMarket.scarcity(s, id) > 1.1 || (doy >= 20 && doy < 80))) {
                if (MerchantPrince.sellFrom(player, world, w.id, id, Math.floor(qty)).success) count(stats, 'warehouseSales');
            }
        }
        if (MerchantPrince.used(w) < 1 && (doy < 80 || doy > 95) && MerchantPrince.closeWarehouse(player, world, w.id).success) count(stats, 'warehousesClosed');
    }
    // Forward contracts: promise grain we already store or carry, deliver when here
    const st = MerchantPrince.state(player);
    for (const f of st.forwards.slice()) {
        const can = MerchantPrince.deliverable(player, world, f);
        if (can.warehouse > 0 && MerchantPrince.deliverForward(player, world, f.id, f.qty, 'warehouse').success) count(stats, 'forwardDeliveries');
        else if (can.inventory > 0 && MerchantPrince.deliverForward(player, world, f.id, f.qty, 'inventory').success) count(stats, 'forwardDeliveries');
    }
    if (w && !st.forwards.length && (w.goods.grain || 0) >= 30) {
        if (MerchantPrince.signForward(player, world, tile, 'grain', 25, 20).success) count(stats, 'forwardsSigned');
    }
}

/** Town guilds: join the trades the bot deals in, climb the ladder, fill contracts, stand for guildmaster. */
function guilds(game, tile, stats) {
    const { player, world } = game;
    const s = tile.settlement;
    if (!s.guilds) return;
    const mine = player.guilds ? Object.keys(player.guilds.memberships).length : 0;
    // (not in the first hundred days: guild fees early on starve the company and the ships of their capital)
    const settled = world.day > 100;
    if (mine < 2 && settled && player.gold > 1500) {
        for (const gid of ['bakers', 'brewers', 'millers', 'merchants', ...Object.keys(s.guilds)]) {
            if (!s.guilds[gid] || Guilds.membership(player, s, gid)) continue;
            if (Guilds.join(player, world, tile, gid).success) { count(stats, 'craftGuildJoined'); break; }
        }
    }
    for (const gid of Object.keys(s.guilds || {})) {
        const m = Guilds.membership(player, s, gid);
        if (!m) continue;
        const q = Guilds.advanceQuote(player, world, tile, gid);
        const onlyGoods = q.needs.length && q.needs.every(n => n.met || /masterpiece/.test(n.label));
        // (a rank's fee is 120 for a journeyman, 400 for a master: kept a working purse above it)
        if (onlyGoods && player.gold > q.fee + 1500) buyMaterials(game, tile, q.goods, stats);
        if (Guilds.advanceQuote(player, world, tile, gid).ok && player.gold > q.fee + 800 && Guilds.advance(player, world, tile, gid).success) count(stats, 'guildRankUp');
        if (m.rank >= 2 && !m.candidate) Guilds.stand(player, world, s, gid, true);
        // A contract for what the bot carries
        for (const o of Guilds.contractOffers(player, world, s, gid)) {
            if ((player.inventory[o.good] || 0) >= o.qty && Guilds.takeContract(player, world, tile, gid, o.good).success) count(stats, 'guildContracts');
        }
    }
    for (const c of (player.guilds && player.guilds.contracts) || []) {
        if (c.q === tile.q && c.r === tile.r && Guilds.deliverContract(player, world, c.id).success) count(stats, 'guildDeliveries');
    }
}

/**
 * Mining leases (systems/concessions.js): now and then from the sixth year and with
 * money to spare, bid the least bid on an open auction of a realm's deposit
 * near here when the lease looks like it repays its fee well inside the
 * term. Picks by a hash of the day and the town, not the RNG, so the rest of
 * the run's dice stay where they were.
 */
function concessions(game, tile, stats) {
    const { player, world } = game;
    const s = tile.settlement;
    // (a lease's fee runs a few hundred gold to about 1,500: a purse of 1,500 can bid — a mid-game
    // investment, from the sixth year, once the company and its works have had the first years' coin)
    if (world.day <= 600 || player.gold < 1500 || s.kingdom == null || founding(game)) return;
    if (((world.day * 7 + tile.q * 13 + tile.r * 17) % 3) !== 0) return;
    const held = Concessions.mine(player, world).length;
    if (held >= 2) return;
    for (const { a, site } of Concessions.auctionsNear(world, tile.q, tile.r, 12)) {
        if (a.kingdomId !== s.kingdom) continue;
        const q = Concessions.leaseQuote(player, world, site.id);
        if (!q.ok || !q.est || !(q.est.net > 0)) continue;
        // (the houses bid up to about a fifth of the term's net at the close: match the top of that)
        const worth = q.est.net * q.est.term * q.est.cap;
        const fee = Math.max(q.minBid, Math.round(worth * 0.22));
        if (a.bid > 0 || worth < fee * 2.5 || player.gold < fee + 800) continue;
        if (Concessions.bid(player, world, a.id, fee).success) { count(stats, 'leaseBids'); break; }
    }
    // Leases won: count each once
    for (const m of Concessions.mine(player, world)) {
        if (!m.c.botSeen) { m.c.botSeen = true; count(stats, 'leasesHeld'); }
    }
}

/**
 * Public works (systems/publicWorks.js): once settled and with money to
 * spare, fund one work at a time near here (no more than one a year) — a
 * toll highway on a busy road whose Steward's estimate repays inside 900
 * days, or failing that repairs on a worn road of the realm, or a track made
 * a road (no toll: a gift to the town) — and top up a work stalled for
 * funds. Picks by a hash of the day and the town (no RNG).
 */
function publicWorks(game, tile, stats) {
    const { player, world } = game;
    // (a road's repairs cost tens of gold, a track made a road a few hundred: a purse of 1,500 can fund one)
    if (world.day < 150 || player.gold < 1500 || frugal(game)) return;
    const mine = PublicWorks.playerWorks(world).filter(w => w.status === 'building' || w.status === 'stalled');
    for (const w of mine) {
        if (w.stall === 'funds' && player.gold > 2000 && PublicWorks.fund(world, player, w.id).success) count(stats, 'publicWorksTopped');
    }
    // (one at a time, and a gift to the realm's roads no more than once a year)
    if (mine.length || world.day - (game.lastPublicWork ?? -1e9) < 120 || ((world.day * 5 + tile.q * 3 + tile.r * 11) % 7) !== 0) return;
    const near = Transport.segmentsNear(world, tile.q, tile.r, 6);
    const spare = player.gold - 1000;
    let pick = null;
    // A toll highway that repays inside a few years (a long game: 900 days is under eight years)
    for (const seg of near) {
        const est = PublicWorks.tollEstimate(world, player, 'upgrade_highway', seg.key);
        if (est && est.payback && est.payback <= 900 && est.cost < spare && (!pick || est.payback < pick.est.payback)) pick = { kind: 'upgrade_highway', seg, est, toll: true };
    }
    // ...else repairs on a worn road, else a track near the town made a road (no toll: a gift to the town)
    for (const kind of ['repair', 'upgrade_road']) {
        if (pick) break;
        for (const seg of near) {
            const q = PublicWorks.quote(world, kind, seg.key);
            if (!q.ok || !(q.cost < spare)) continue;
            if (kind === 'repair' && Transport.band(Transport.segState(world, seg)) === 'good') continue;
            pick = { kind, seg, toll: false };
            break;
        }
    }
    if (pick && PublicWorks.commission(world, player, pick.kind, pick.seg.key, { by: 'player', toll: pick.toll }).success) {
        game.lastPublicWork = world.day;
        count(stats, 'publicWorksFunded');
    }
}

/**
 * Specie & mints (systems/mints.js): at a capital's mint, sell the gold and
 * silver in the packs when the mint pays at least the market; elsewhere, now
 * and then, buy a little ore where it is glutted (well under what a mint
 * pays) to carry to one. Hash picks, no RNG.
 */
const BULLION = ['gold_ore', 'silver_ore', 'gold_bar'];
function mints(game, tile, stats) {
    const { player, world } = game;
    if (Mints.mintAt(world, tile)) {
        for (const id of BULLION) {
            const have = Math.floor(player.inventory[id] || 0);
            if (have <= 0) continue;
            const q = Mints.bullionQuote(player, world, tile, id);
            const good = PlayerEconomy.GOODS[id.toUpperCase()];
            const market = good ? Trading.saleUnitPrice(player, good, tile.settlement, world, 1, have) : 0;
            if (q.ok && q.unit >= market * 0.95 && Mints.sellBullion(player, world, tile, id, have).success) count(stats, 'bullionSold');
        }
        return;
    }
    if (world.day < 120 || player.gold < 4000 || ((world.day * 3 + tile.q * 7 + tile.r * 5) % 4) !== 0) return;
    if (BULLION.some(id => (player.inventory[id] || 0) > 0)) return;
    const fine = (Mints.config().mint || {}).fine || {};
    for (const g of Trading.getAvailableGoods(tile.settlement, tile, world)) {
        if (!BULLION.includes(g.id) || !(g.quantity >= 2) || !(g.price > 0) || !(g.price < (fine[g.id] || 0) * 0.8)) continue;
        const qty = Math.min(6, Trading.affordable(player, g, tile.settlement, 6));
        if (qty > 0 && Trading.buyGoods(player, g, qty, tile.settlement).success) { count(stats, 'bullionBought'); return; }
    }
}

/**
 * The agricultural year (world/harvests.js): each farm's rotation follows
 * its soil (worn land rests, rich land is worked hard), and now and then a
 * crop report of a failing harvest elsewhere sends grain bought cheap here
 * toward that region, sold there above the bot's own bread. Picks by a hash
 * of the day and the town, not the RNG.
 */
function harvests(game, tile, stats) {
    const { player, world } = game;
    const C = Harvests.config();
    if (world.day % 7 === 0) {
        for (const ref of player.properties || []) {
            const crop = ref && C.propertyCrops[ref.type];
            if (!crop || crop === 'stock') continue;
            const t = world.getTile(ref.q, ref.r);
            const prop = t && Array.isArray(t.playerProperties) ? t.playerProperties.find(p => p && p.type === ref.type) : null;
            if (!prop) continue;
            // Work good soil hard; rest it when it wears thin, until it's rich again
            const soil = Number.isFinite(prop.soil) ? prop.soil : 1;
            const cur = Harvests.rotation(prop).id;
            const want = soil < 0.8 ? 'rest' : cur === 'rest' ? (soil >= 1.05 ? 'intensive' : 'rest') : soil >= 0.95 ? 'intensive' : cur;
            if (cur !== want && Harvests.setRotation(player, world, ref.q, ref.r, ref.type, want).success) count(stats, 'rotationsSet');
        }
    }
    // A cargo of grain carried to a failing harvest: sell it on arrival
    const run = game.harvestRun;
    if (run && (world.day - run.day > 40 || !(player.inventory.grain > 0))) game.harvestRun = null;
    else if (run && run.q === tile.q && run.r === tile.r) {
        const qty = Math.min(run.qty, Math.floor(player.inventory.grain) - 10);
        if (qty > 0 && Trading.sellGoods(player, 'grain', qty, tile.settlement, world).success) count(stats, 'harvestSales');
        game.harvestRun = null;
        return;
    }
    if (game.harvestRun || player.gold < 3000 || ((world.day * 11 + tile.q * 7 + tile.r * 3) % 6) !== 0) return;
    // ...bought where grain is plentiful, for a region the crop reports say is failing
    const here = Harvests.regionOf(world, tile.q, tile.r);
    const failing = new Set(Harvests.known(player, world)
        .filter(k => k.id !== here && k.est < C.forecast.poorBelow && world.day - k.day <= 21).map(k => k.id));
    if (!failing.size || SettlementMarket.scarcity(tile.settlement, 'grain') > 1) return;
    const target = world.getSettlementViews()
        .filter(s => failing.has(Harvests.regionOf(world, s.q, s.r)) && Hex.wrappingDistance(s.q, s.r, tile.q, tile.r, world.width) <= 25)
        .sort((a, b) => Hex.wrappingDistance(a.q, a.r, tile.q, tile.r, world.width) - Hex.wrappingDistance(b.q, b.r, tile.q, tile.r, world.width))[0];
    const g = target && Trading.getAvailableGoods(tile.settlement, tile, world).find(x => x.id === 'grain');
    if (!g || g.quantity < 10 || !(g.price > 0)) return;
    const qty = Math.min(Trading.affordable(player, g, tile.settlement, 30), Math.floor((player.gold * 0.03) / g.price));
    if (qty >= 5 && Trading.buyGoods(player, g, qty, tile.settlement).success) {
        count(stats, 'harvestTrades');
        game.harvestRun = { q: target.q, r: target.r, qty, day: world.day };
        game.dest = { q: target.q, r: target.r };
    }
}

/**
 * Land and the cottage looms (systems/landMarket.js, systems/puttingOut.js):
 * cloth put out here is collected; in autumn and winter wool or flax (bought
 * here when it is cheap) goes out to the cottagers at the fair rate; after
 * day 600 (mid-game), with gold to spare, the cheapest estate here or for sale nearby is
 * bought (one, here or in a town round about; keeping 1,000g in hand for the rest of the trade), its rent taken in kind when the tenants grow sullen
 * and its fields drained when there is money for it. Picks by a hash of the
 * day and the town, not the RNG.
 */
function land(game, tile, stats) {
    const { player, world } = game;
    const s = tile.settlement;
    if (!Estates.enabled()) return;
    if (PuttingOut.batches(player, s.q, s.r).some(b => b.done)) {
        const r = PuttingOut.collect(player, world, tile);
        if (r.units > 0) count(stats, 'clothCollected');
    }
    const season = Seasons.seasonOf(world.day);
    if ((season === 'Winter' || season === 'Autumn') && world.day > 60 && player.gold > 500 && ((world.day * 3 + tile.q + tile.r * 7) % 3) === 0) {
        for (const input of ['wool', 'flax']) {
            let have = Math.floor(player.inventory[input] || 0);
            if (have < 10 && player.gold > 900) {
                const g = Trading.getAvailableGoods(s, tile, world).find(x => x.id === input);
                const base = (PlayerEconomy.GOODS[input.toUpperCase()] || {}).basePrice || 10;
                if (g && g.quantity >= 15 && g.price > 0 && g.price <= base * 1.2) {
                    const qty = Math.min(20, Trading.affordable(player, g, s, 20));
                    if (qty >= 10 && Trading.buyGoods(player, g, qty, s).success) have = Math.floor(player.inventory[input] || 0);
                }
            }
            if (have >= 10 && PuttingOut.putOut(player, world, tile, input, Math.min(have, 40), 'fair').success) { count(stats, 'workPutOut'); break; }
        }
    }
    const mine = LandMarket.mine(player, world);
    // (a mid-game investment, from the sixth year: the first years' coin goes to the company, its posts
    // and works; and not while the company's sum is put by: the charter and its capital come first)
    if (world.day > 600 && mine.length < 1 && !founding(game) && ((world.day * 5 + tile.q * 3 + tile.r) % 4) === 0) {
        // (the holders' asks here and in the towns round about — the cheapest estates go for a few
        // hundred to two thousand gold, and a buyer asks around — and what is listed for sale nearby)
        const towns = [{ q: s.q, r: s.r }, ...nearest(world, player, settlementTiles(world), 8).filter(t => t.d <= 8)];
        const ids = [...new Set([...towns.flatMap(t => Estates.estatesOf(world, t.q, t.r).map(e => e.id)), ...LandMarket.listingsNear(world, s.q, s.r, 12).map(x => x.e.id)])];
        // (one is bought with 1,000 kept in hand)
        const quotes = ids.map(id => LandMarket.buyQuote(player, world, id)).filter(q => q.ok && q.cost <= player.gold - 1000).sort((a, b) => a.cost - b.cost || String(a.estate.id).localeCompare(String(b.estate.id)));
        if (quotes.length && LandMarket.buy(player, world, quotes[0].estate.id).success) count(stats, 'estatesBought');
    }
    if (world.day % 7 === 0) {
        for (const e of mine) {
            if (e.loyalty < 35 && e.mode !== 'kind' && LandMarket.setRent(player, world, e.id, 'customary', 'kind').success) count(stats, 'rentsSet');
            const q = LandMarket.worksQuote(player, world, e.id, 'drain');
            if (q.ok && player.gold > q.cost + 2000 && LandMarket.improve(player, world, e.id, 'drain').success) count(stats, 'estateWorks');
        }
    }
}

function settlementBusiness(game, stats) {
    const { player, world } = game;
    const tile = world.getTile(player.q, player.r);
    if (!tile || !tile.settlement) return;
    // Use the contextual list the action menu shows, as a sanity check that it builds
    PlayerActions.getAvailableActions(player, tile, world);
    // (a bot saving for its company forgoes new soldiers and companions, ships, lessons and luxuries)
    const saving = frugal(game);
    booked(game, 'buyFood', () => buyFood(game, tile, stats));
    booked(game, 'mints', () => mints(game, tile, stats));
    booked(game, 'sellGoods', () => sellGoods(game, tile, stats));
    if (!saving) booked(game, 'speculate', () => speculate(game, tile, stats));
    if (!saving) booked(game, 'recruit', () => recruit(game, tile, stats));
    booked(game, 'underworld', () => underworld(game, tile, stats));
    booked(game, 'gangs', () => gangLife(game, tile, stats));
    if (!saving) booked(game, 'companions', () => companions(game, tile, stats));
    booked(game, 'work', () => work(game, tile, stats));
    booked(game, 'properties', () => properties(game, tile, stats));
    if (!saving) booked(game, 'ships', () => ships(game, tile, stats));
    if (!saving) booked(game, 'sea', () => seaActivity(game, tile, stats));
    booked(game, 'heist', () => heist(game, tile, stats));
    booked(game, 'company', () => company(game, tile, stats));
    if (!saving) booked(game, 'patronage', () => patronage(game, tile, stats));
    booked(game, 'banking', () => banking(game, tile, stats));
    booked(game, 'insurance', () => insurance(game, tile, stats));
    booked(game, 'bills', () => bills(game, tile, stats));
    booked(game, 'bourse', () => bourse(game, tile, stats));
    booked(game, 'merchantPrince', () => merchantPrince(game, tile, stats));
    booked(game, 'guilds', () => guilds(game, tile, stats));
    booked(game, 'concessions', () => concessions(game, tile, stats));
    booked(game, 'harvests', () => harvests(game, tile, stats));
    booked(game, 'land', () => land(game, tile, stats));
    booked(game, 'publicWorks', () => publicWorks(game, tile, stats));
    if (!saving) booked(game, 'tongues', () => tongues(game, tile, stats));
    if (!saving) booked(game, 'bathe', () => bathe(game, stats));
    if (!saving) booked(game, 'hiredWork', () => hiredWork(game, tile, stats));
    booked(game, 'alms', () => alms(game, tile, stats));
    booked(game, 'mendName', () => mendName(game, tile, stats));
}

/**
 * Mending its name (systems/devotion.js donate → the poor of the town): a bot that has
 * run with gangs and pirates can stand below every crown's charter bar (merchantHouses
 * charter.minReputation), and then never founds its company. While no crown will charter
 * it and it has coin to spare, once a week it gives to the poor of a town whose crown
 * thinks ill of it: up to +5 reputation a gift (devotion.json donations.poor).
 */
function mendName(game, tile, stats) {
    const { player, world } = game;
    const s = tile && tile.settlement;
    if (!s || !s.kingdom || world.day < 150 || player.gold < 1000 || MerchantHouses.hasCompany(player)) return;
    if (MerchantHouses.hasCharter(player) || MerchantHouses.officeCharter(player)) return;
    if (world.day - (game.lastMend ?? -1e9) < 7) return;
    // (the company plan found no willing crown it can walk to: companyTarget)
    companyTarget(game);
    const plan = game.companyPlan;
    if (!plan || plan.kingdomId != null) return;
    const minRep = MerchantHouses.config().charter.minReputation;
    if (((player.reputation || {})[s.kingdom] || 0) >= minRep) return;
    if (Devotion.donate(player, world, tile, 'poor', 100).success) {
        game.lastMend = world.day;
        count(stats, 'nameMended');
    }
}

/**
 * Alms (systems/devotion.js donate → a needy townsperson of the town's roster):
 * with a little to spare, about once a month a few coins to the neediest soul here —
 * an old woman alone, a beggar at the gate. They remember it (systems/npcMemory.js),
 * and a remembered kindness is what a house quest of an old favour is made of.
 * Picks by a hash of the day and the town (no RNG); at most one gift a month.
 */
function alms(game, tile, stats) {
    const { player, world } = game;
    if (world.day < 120 || player.gold < 300 || world.day - (game.lastAlms ?? -1e9) < 30) return;
    if (((world.day * 7 + tile.q * 5 + tile.r * 3) % 4) !== 0) return;
    const p = Devotion.needyFolk(world, tile, 1)[0];
    if (!p) return;
    // (a few coppers while saving for the company: it can still spare those)
    const amount = frugal(game) ? 10 : player.gold > 3000 ? 50 : player.gold > 1500 ? 20 : 10;
    if (Devotion.donate(player, world, tile, `folk:${p.id}`, amount).success) {
        game.lastAlms = world.day;
        count(stats, 'almsGiven');
    }
}

/**
 * A town of another tongue (systems/languages.js): a lesson with its tutor
 * while the purse allows, an interpreter hired while the bot is lost for
 * words there, and let go once it can manage alone (or can't pay).
 */
function tongues(game, tile, stats) {
    const { player, world } = game;
    const lang = Languages.settlementLanguage(world, tile.settlement);
    if (!lang || !player.languages) return;
    const own = Languages.fluency(player, lang);
    const c = Languages.comprehension(player, lang);
    if (own >= 50) {
        // Fluent enough here: the interpreter (if this is the tongue they were for) goes
        if (player.translator && Languages.translatorIn(player, lang) > 0 && Utils.random() < 0.2
            && Languages.dismissTranslator(player).success) count(stats, 'interpretersDismissed');
        return;
    }
    count(stats, 'foreignTownDays');
    if (player.translator && player.gold < 150 && Languages.dismissTranslator(player).success) count(stats, 'interpretersDismissed');
    if (player.gold >= 300 && Languages.lesson(player, world, lang).success) count(stats, 'langLessons');
    if (!player.translator && c.value < 25 && player.gold >= 800 && Languages.hireTranslator(player, world).success) count(stats, 'interpretersHired');
}

/** Grimy: wash at the river, the well or the bathhouse (player/core/needs.js), when the coin is to spare. */
function bathe(game, stats) {
    const { player, world } = game;
    if (!player.needs || player.needs.hygiene >= 30 || !player.bathePlace) return;
    const place = player.bathePlace(world);
    if (!place || player.gold < place.cost + 50) return;
    if (player.bathe(world).success) count(stats, place.kind === 'wild' ? 'bathedWild' : 'bathedInTown');
}

/**
 * Hired work in a town's mill, bakery or smithy (systems/commissions.js):
 * collect what is ready, and now and then hand over goods the bot isn't
 * eating to be worked up, paying the fee.
 */
function hiredWork(game, tile, stats) {
    const { player, world } = game;
    for (const j of Commissions.pending(player)) {
        if (j.q === tile.q && j.r === tile.r && Commissions.isReady(j, world)) {
            if (Commissions.collect(player, world).success) count(stats, 'commissionsCollected');
            break;
        }
    }
    if (player.gold < 300 || Utils.random() > 0.2 || Commissions.pending(player).length >= 2) return;
    const edible = player.constructor.FOOD_TYPES || [];
    for (const o of Commissions.offers(world, tile.settlement)) {
        // (not the bread it eats, nor the bullion it carries to a mint)
        if (Object.keys(o.in).some(g => edible.includes(g) || FOOD.includes(g) || BULLION.includes(g))) continue;
        const runs = Math.min(Commissions.maxRuns(player, o), 10);
        if (runs < 1) continue;
        if (Commissions.commission(player, world, o.id, runs, Utils.random() < 0.5 ? 'fee' : 'cut').success) { count(stats, 'commissioned'); return; }
    }
}

// ── Out in the world ─────────────────────────────────────────

function fight(game, stats) {
    const { player, world } = game;
    const strength = PlayerMilitary.getArmyStrength(player);
    if (strength <= 0) return;
    const foes = world.units.filter(u => !u.destroyed && WorldUnit.HOSTILE_TYPES.includes(u.type)
        && Hex.wrappingDistance(u.q, u.r, player.q, player.r, world.width) <= 3
        && u.strength < strength * 0.8);
    if (!foes.length) return;
    const res = PlayerMilitary.attackUnit(player, foes[0], world);
    count(stats, res && res.victory ? 'battlesWon' : 'battlesFought');
    prisonersDay(game, stats);
}

/**
 * The fate of prisoners (player/prisonerFates.js), as a middling lord would
 * choose: oath-breakers hang; knights are ransomed at a fair price; a realm's
 * men are mostly sent home on oath, sometimes taken into service, now and
 * then just sent home (and, rarely, a hard lord cuts them down); outlaws
 * mostly hang. Counter-offers are taken, a refused knight sold where a crown
 * will buy him, and your own men bought back when the purse allows.
 */
export function prisonersDay(game, stats) {
    const { player, world } = game;
    // Men who yielded away from a field (a stormed lair, a breach, a deck: world/warStakes.js yieldUp)
    const fresh = PrisonerFates.collect(player, world);
    if (fresh) count(stats, `captivesFrom_${fresh.source || 'field'}`);
    const col = PrisonerFates.pending(player);
    if (col) {
        if (!col.oathDone) PrisonerFates.decideOathBreakers(player, world, true);
        if (PrisonerFates.pending(player) && !col.noblesDone) PrisonerFates.decideNobles(player, world, 'ransom');
        if (PrisonerFates.pending(player)) {
            const x = Utils.random();
            const fate = col.rebel ? (x < 0.45 ? 'mercy' : x < 0.75 ? 'hang_leader' : x < 0.9 ? 'imprison' : 'service')
                : col.outlaw ? (x < 0.7 ? 'hang' : x < 0.85 ? 'service' : 'release')
                    : (x < 0.5 ? 'oath' : x < 0.8 ? 'service' : x < 0.98 ? 'release' : 'slaughter');
            const r = PrisonerFates.decide(player, world, fate);
            count(stats, r.success ? `captives_${fate}` : 'captivesFailed');
        }
    }
    if (!player.interrogation) return;
    for (const w of Interrogation.state(player).pows.slice()) {
        const t = w && w.talks;
        if (t && t.stage === 'offered') { if (PrisonerFates.acceptOffer(player, world, w.id).success) count(stats, 'ransomOffersTaken'); continue; }
        if (t && (t.stage === 'refused' || t.stage === 'broken')) {
            const b = PrisonerFates.buyers(player, world, w)[0];
            if (b && PrisonerFates.sell(player, world, w.id, b.kingdomId).success) count(stats, 'knightsSold');
        }
    }
    for (const h of (player.prisonerFates ? player.prisonerFates.held : []).slice()) {
        if (h.fate === 'ransom' && player.gold >= h.ask * 2 && PrisonerFates.buyBack(player, world, h.id).success) count(stats, 'menBoughtBack');
    }
}

/** An outlaw lair next door: storm it with a clearly stronger army, or buy peace when rich. */
function outlaws(game, stats) {
    const { player, world } = game;
    const lair = OutlawLairs.lairNear(player, world, player.q, player.r, 1);
    if (!lair) return;
    const strength = PlayerMilitary.getArmyStrength(player);
    if (strength > OutlawLairs.garrison(lair) * 2.5 + 20 && player.health >= 50) {
        if (!lair.scouted) OutlawLairs.scout(player, world, lair.id);
        const res = OutlawLairs.assault(player, world, lair.id);
        if (res.success) count(stats, res.cleared ? 'lairsCleared' : 'lairAssaultsFailed');
        // (the lair's survivors who yield: the fate of prisoners)
        if (res.yielded) prisonersDay(game, stats);
        return;
    }
    const kind = OutlawLairs.kind(lair.kind) || {};
    if (kind.parley && !OutlawLairs.sparesPlayer(lair, world.day) && player.gold > OutlawLairs.tributePrice(player, lair) * 4) {
        if (OutlawLairs.payTribute(player, world, lair.id).success) count(stats, 'lairTributes');
    }
}

/**
 * Merchant caravans on the road (systems/merchantCaravans.js): ride with the
 * trader the bot guards; now and then ride up to a caravan nearby and hire on
 * as its escort; and, rarely, as a guild member with a much stronger army,
 * rob one. Returns true while the day goes to the road.
 */
function caravans(game, stats) {
    const { player, world } = game;
    if (player.boardedShip) return false;
    const job = MerchantCaravans.escortJob(world);
    if (job) {
        // Keep with the caravan (the merchant gives up on an escort who strays)
        game.dest = { q: job.q, r: job.r };
        travelTo(game, job.q, job.r);
        count(stats, 'escortDays');
        return true;
    }
    const strength = PlayerMilitary.getArmyStrength(player);
    if (strength <= 0 || player.health < 60 || player.getFoodCount() < 12 || Sieges.active(player)) return false;
    const dist = (u) => Hex.wrappingDistance(u.q, u.r, player.q, player.r, world.width);
    const near = MerchantCaravans.traders(world).filter(u => u.type === 'trade_caravan' && !u.escort && dist(u) <= 4)
        .sort((a, b) => dist(a) - dist(b) || (a.id < b.id ? -1 : 1));
    if (!near.length) return false;
    const u = near[0];
    // A rare robbery: a guild member, a far stronger army, little heat with the realm
    const uw = Underworld.ensure(player);
    const kid = u.kingdomId;
    if (uw.guild.member && strength > u.strength * 2.5 && Utils.random() < 0.04
        && (kid == null || Underworld.getHeat(player, kid) < 30)) {
        travelTo(game, u.q, u.r);
        if (dist(u) <= 1) {
            const res = PlayerMilitary.attackUnit(player, u, world);
            count(stats, res && res.victory ? 'caravansRobbed' : 'robberiesFailed');
            return true;
        }
        return false;
    }
    // Hire on as escort now and then, when the army can see off an ambush
    if (strength >= 10 && Utils.random() < 0.2) {
        travelTo(game, u.q, u.r);
        if (MerchantCaravans.canEscort(player, world, u).ok && MerchantCaravans.hireEscort(player, world, u.id).success) {
            count(stats, 'escortsHired');
            return true;
        }
    }
    return false;
}

function delve(game, stats) {
    const { player, world } = game;
    const tile = world.getTile(player.q, player.r);
    if (!Delves.active(player)) {
        if (!Delves.isDelveSite(tile)) return;
        if (player.health < 50) { count(stats, 'delveTooHurt'); return; }
        const st = Delves.start(player, world, tile);
        if (!st.success) { count(stats, 'delveRefused'); (game.unreachableSites || (game.unreachableSites = new Set())).add(`${tile.q},${tile.r}`); return; }
        count(stats, 'delvesStarted');
        game.delved = true;
        game.trek = null;
    }
    let guard = 0;
    while (Delves.active(player) && guard++ < 12) {
        const a = Delves.active(player);
        if (a.phase === 'between') {
            if (a.index >= 3 || player.health < 45) { Delves.retreat(player, world); break; }
            Delves.pressOn(player);
            continue;
        }
        const options = Delves.describeChoices(player).filter(c => c.can.ok);
        if (!options.length) { Delves.retreat(player, world); break; }
        options.sort((x, y) => (y.chance === null ? 1 : y.chance) - (x.chance === null ? 1 : x.chance));
        const res = Delves.choose(player, world, options[0].id);
        if (!res.success) { Delves.retreat(player, world); break; }
        if (res.ended) count(stats, `delve_${res.ended}`);
    }
}

/**
 * A first colony: a free site (at least MIN_SETTLEMENT_DISTANCE from every
 * town — so never within the 3 hexes of a town the bot stands in, where it
 * used to look and never found one) on its own landmass within a few days'
 * walk, held to until reached, over days if need be, and founded there; then
 * back to its ship. Returns true while on the way (the day's travel is
 * spent) or on the day it founds.
 */
const COLONY_SEARCH = 9;
function foundColony(game, stats) {
    const { player, world } = game;
    if ((player.colonies || []).length || player.gold < Colonization.COLONY_COST + 1500) { game.colonySite = null; return false; }
    const bad = game.unreachableSites || (game.unreachableSites = new Set());
    const fits = (q, r) => {
        const t = world.getTile(q, r);
        return !!t && !bad.has(`${q},${r}`) && player._overlandReachable(q, r, world)
            && Colonization.canPlayerFoundColony(player, t, world, q, r).can;
    };
    let site = game.colonySite;
    if (site && !fits(site.q, site.r)) site = null;
    // (a look round that found nothing is not repeated for a week)
    if (!site && !(game.colonyLookedOn > world.day - 7)) {
        game.colonyLookedOn = world.day;
        // (the towns near enough to matter, once: canPlayerFoundColony walks them all for each hex)
        const towns = settlementTiles(world).filter(t => Hex.wrappingDistance(player.q, player.r, t.q, t.r, world.width) <= COLONY_SEARCH + Colonization.MIN_SETTLEMENT_DISTANCE);
        const clear = (q, r) => towns.every(t => Hex.wrappingDistance(q, r, t.q, t.r, world.width) >= Colonization.MIN_SETTLEMENT_DISTANCE);
        for (const h of Hex.hexesInRange(player.q, player.r, COLONY_SEARCH)) {
            if (h.r < 0 || h.r >= world.height) continue;
            const q = Hex.wrapQ(h.q, world.width);
            const t = world.getTile(q, h.r);
            if (!t || !t.terrain.passable || !clear(q, h.r) || !fits(q, h.r)) continue;
            const d = Hex.wrappingDistance(player.q, player.r, q, h.r, world.width);
            if (!site || d < site.d) site = { q, r: h.r, d };
        }
    }
    game.colonySite = site;
    if (!site) return false;
    const from = `${player.q},${player.r}`;
    if (!travelTo(game, site.q, site.r)) {
        // No way there after all: drop it and look again another day
        if (`${player.q},${player.r}` === from && !player.crossing) { bad.add(`${site.q},${site.r}`); game.colonySite = null; return false; }
        count(stats, 'travelDays');
        return true;
    }
    game.colonySite = null;
    const res = Colonization.foundPlayerColony(player, world.getTile(site.q, site.r), world, site.q, site.r, null, 'coexistence');
    if (res.success) {
        count(stats, 'coloniesFounded');
        // ...and back to the ship, laid up in the port it set out from
        const laid = (player.ships || []).find(sh => sh.status === 'docked' && player._overlandReachable(sh.q, sh.r, world));
        if (laid) game.dest = { q: laid.q, r: laid.r, ship: true };
        return true;
    }
    return false;
}

/** The nearest delve site the bot hasn't failed to reach → { q, r, delve: true } or null. */
function delveSite(game) {
    const { player, world } = game;
    const bad = game.unreachableSites || (game.unreachableSites = new Set());
    let best = null;
    // (wider until the first delve: the sites near home may all be explored by others)
    for (const h of Hex.hexesInRange(player.q, player.r, game.delved ? 24 : 40)) {
        if (h.r < 0 || h.r >= world.height) continue;
        const q = Hex.wrapQ(h.q, world.width);
        const t = world.getTile(q, h.r);
        if (!t || !t.terrain.passable || !Delves.isDelveSite(t) || bad.has(`${q},${h.r}`) || !player._overlandReachable(q, h.r, world)) continue;
        // (a site whose road the bot was beaten back on is tried again after 30 days)
        if (game.trekBeaten && world.day - (game.trekBeaten[`${q},${h.r}`] ?? -1e9) < 30) continue;
        const d = Hex.distance(player.q, player.r, h.q, h.r);
        if (!best || d < best.d) best = { q, r: h.r, d };
    }
    return best ? { q: best.q, r: best.r, delve: true } : null;
}

// ── A crowned ruler keeps court ─────────────────────────────
// The bot used to rule as it wandered: a king working odd jobs town to town,
// the palace a thousand miles behind, and in a dearth (a bare market, the
// next town days off) lives died in the wild with 700 gold in the purse — 25
// of 40 deaths in the round-2 endgame soak were monarchs starved so. A ruler
// keeps the palace larder full from the capital's market (player/household.js:
// its table feeds the ruler when the packs are empty), takes bread from it for
// the road, comes home when the packs run low, and keeps within a few days of
// the seat (chooseDestination).

/** The ruler's seat: the palace kept by the crown, else a house in the capital, else the capital. */
export function royalSeat(game) {
    const { player, world } = game;
    const k = Throne.ruledKingdom(player, world);
    if (!k || !k.capital) return null;
    // A royal progress to a far crown (game.progress, set by the endgame soak's grow mode:
    // { kingdomId, until }): its capital is the seat until then — the court rides with the ruler
    const pr = game.progress;
    if (pr && world.day < pr.until && HighCrowns.unionCrown(player, pr.kingdomId)) {
        const fk = world.getKingdom(pr.kingdomId);
        if (fk && fk.isAlive && fk.capital) return { q: fk.capital.q, r: fk.capital.r, key: null, kingdom: fk, progress: true };
    }
    const houses = player.houses || [];
    const h = houses.find(x => x && String(x.keptBy) === String(k.id))
        || houses.find(x => x && x.q === k.capital.q && x.r === k.capital.r);
    const q = h ? h.q : k.capital.q;
    const r = h ? h.r : k.capital.r;
    const key = h ? Household.houseKey(h) : null;
    return { q, r, key, kingdom: k };
}
// Rations the palace larder is kept at, and the packs a ruler sets out with
const COURT_LARDER = 15;
const COURT_TETHER = 12;
const larderOf = (player, seat) => (seat && seat.key ? Household.home(player, seat.key, true, { q: seat.q, r: seat.r }) : null);

function keepCourt(game, stats) {
    const { player, world } = game;
    if (player.boardedShip || Ships.getVoyage(player)) return false;
    const seat = royalSeat(game);
    if (!seat) return false;
    const home = larderOf(player, seat);
    const atSeat = player.q === seat.q && player.r === seat.r;
    // On a royal progress: on the road to the far capital (fed for the way: the food runs below come first)
    if (seat.progress && !atSeat && player.getFoodCount() > 4 && !Delves.active(player) && !Sieges.active(player) && !Throne.state(player).civilWar) {
        const from = `${player.q},${player.r}`;
        game.dest = { q: seat.q, r: seat.r, court: true };
        travelTo(game, seat.q, seat.r);
        if (`${player.q},${player.r}` !== from || player.crossing) { count(stats, 'progressDays'); return true; }
        // (no step today — the day's legs already walked, or no road at all: over the sea, it is given up)
        if (typeof player._overlandReachable === 'function' && !player._overlandReachable(seat.q, seat.r, world)) game.progress = null;
        count(stats, 'progressNoWay');
        return false;
    }
    if (atSeat && home) {
        // The larder kept full from the capital's market: grain first (it keeps), then what the stalls have
        if (Household.rations(home) < COURT_LARDER && player.gold >= 60) {
            const food = Household.marketFood(player, world, home).sort((a, b) => (a.id === 'grain' ? -1 : 0) - (b.id === 'grain' ? -1 : 0));
            for (const g of food) {
                if (Household.rations(home) >= COURT_LARDER) break;
                const want = Math.ceil((COURT_LARDER - Household.rations(home)) * 35 / Math.max(1, MEAL_HUNGER[g.id] || 15));
                const res = Household.buy(player, world, seat.key, g.id, want, Math.max(0, player.gold - 40));
                if (res.success) count(stats, 'courtLarder', res.n);
            }
        }
        // The market bare and the packs light: bread for the road from the larder (two days' worth left at home)
        if (player.getFoodCount() < 6 && Household.rations(home) > 2) {
            for (const id of Object.keys(home.larder)) {
                while (player.getFoodCount() < 6 && Household.rations(home) > 2 && (home.larder[id] || 0) > 0) {
                    if (!Household.take(player, seat.key, id, 1).success) break;
                    count(stats, 'courtLarderTaken');
                }
            }
        }
        return false;
    }
    // A thin purse: home to court, to earn and eat there (the capital's work and stalls, the
    // royal kitchens — Household.royalTable), not on the road town to town after wages
    const left0 = player.getFoodCount();
    if (player.gold < poorBelow(game) && !Delves.active(player) && !Sieges.active(player) && !Throne.state(player).civilWar) {
        const days = tripDays(game, seat.q, seat.r);
        if (days != null && days <= left0 + 3) {
            const from = `${player.q},${player.r}`;
            game.dest = { q: seat.q, r: seat.r, court: true };
            game.headingTo = { q: seat.q, r: seat.r, day: world.day };
            travelTo(game, seat.q, seat.r);
            if (`${player.q},${player.r}` !== from || player.crossing) {
                count(stats, 'poorToCourt');
                const now = world.getTile(player.q, player.r);
                if (now && now.settlement) booked(game, 'buyFood', () => buyFood(game, now, stats));
                return true;
            }
        }
    }
    // Away with the packs running low and no bread on this town's stalls: home to the
    // royal table while the packs last the road (the larder stocked, or the capital's market)
    const here = world.getTile(player.q, player.r);
    const sells = here && here.settlement && stallFood(here.settlement) >= STALL_ENOUGH;
    const left = player.getFoodCount();
    if (left <= 4 && !sells && !Delves.active(player) && !Sieges.active(player)) {
        const days = tripDays(game, seat.q, seat.r);
        // (only while the packs last the road: at left + 3 a king set out on four days' food
        // for a court seven days off and starved three hexes short — seed 101 2026-11-24)
        if (days != null && days <= left && (!home || Household.rations(home) >= 2 || player.gold >= 30)) {
            game.dest = { q: seat.q, r: seat.r, court: true };
            game.headingTo = { q: seat.q, r: seat.r, day: world.day };
            travelTo(game, seat.q, seat.r);
            count(stats, 'homeToCourt');
            const now = world.getTile(player.q, player.r);
            if (now && now.settlement) booked(game, 'buyFood', () => buyFood(game, now, stats));
            return true;
        }
    }
    return false;
}

function chooseDestination(game) {
    const dest = pickDestination(game);
    // (a ruler keeps within a few days of the seat: back to court from a road that strays)
    const seat = royalSeat(game);
    if (seat && dest && Hex.wrappingDistance(seat.q, seat.r, dest.q, dest.r, game.world.width) > COURT_TETHER
        && (game.player.q !== seat.q || game.player.r !== seat.r)) return { q: seat.q, r: seat.r, court: true };
    return dest;
}

function pickDestination(game) {
    const { player, world } = game;
    const roll = Utils.random();
    // (only when fit for it: hale, fed for the road and not broke — a delve trek on an empty
    // larder killed lives; after day 45 it looks every time until it has delved once)
    const fit = player.health >= 60 && player.getFoodCount() >= 5 && player.gold >= 50;
    if (fit && (roll < 0.2 || (!game.delved && (MerchantHouses.company(player) || world.day >= 45)))) {
        // The nearest delve site the bot hasn't failed to reach. Until it has
        // delved once it looks every time (after its company is founded, or
        // day 45): sites are few, a handful a map, and others explore them,
        // so a chance look can miss them all game
        const site = delveSite(game);
        if (site && fedFor(game, site.q, site.r, 2)) return site;
    }
    // Carrying bullion: on to the nearest realm's capital, where its mint buys it (systems/mints.js)
    if (BULLION.some(id => (player.inventory[id] || 0) > 0)) {
        // (within the pathfinder's reach: Hex.findPath gives up past 50 hexes)
        const mint = nearest(world, player, settlementTiles(world), 60).find(t => t.d <= 45 && Mints.mintAt(world, world.getTile(t.q, t.r)));
        if (mint) return { q: mint.q, r: mint.r };
    }
    // Colonies hold court; drop by now and then
    // (on foot, only places on its own landmass: Player._overlandReachable)
    const walkTo = (t) => !!t && player._overlandReachable(t.q, t.r, world);
    if (roll < 0.3 && walkTo((player.colonies || [])[0])) return { q: player.colonies[0].q, r: player.colonies[0].r };
    // A boss looks in on the gang now and then (systems/gangs.js)
    if (roll >= 0.5 && roll < 0.7) {
        const home = Gangs.bossTowns(player, world).find(b => (b.q !== player.q || b.r !== player.r) && walkTo(b));
        if (home) return { q: home.q, r: home.r };
    }
    // A ship laid up in another port: go back to it now and then, to sail
    if (roll >= 0.3 && roll < 0.4) {
        const laid = (player.ships || []).find(sh => sh.status === 'docked' && (sh.q !== player.q || sh.r !== player.r) && walkTo(sh));
        if (laid) return { q: laid.q, r: laid.r, ship: true };
    }
    // Abroad now and then, once settled in: a town of another tongue within a
    // fortnight's walk (systems/languages.js — immersion, lessons, interpreters)
    if (world.day > 150 && roll >= 0.4 && roll < 0.5 && player.nativeLanguage) {
        const abroad = nearest(world, player, settlementTiles(world), 40).filter(t => t.d <= 30 && (() => {
            const s = world.getTile(t.q, t.r).settlement;
            const l = s && Languages.settlementLanguage(world, s);
            return l && l !== player.nativeLanguage && Languages.fluency(player, l) < 100;
        })());
        if (abroad.length) return Utils.randPick(abroad.slice(0, 6));
    }
    // Money put by and no shares: to the nearest exchange it can walk to, to buy a few (systems/bourse.js)
    if (roll >= 0.7 && roll < 0.8 && world.day > 150 && !frugal(game) && savings(player) >= 1800 && !Bourse.portfolio(player).length) {
        const ex = ((player.bourse && player.bourse.exchanges) || [])
            .map(e => ({ q: e.q, r: e.r, d: Hex.wrappingDistance(player.q, player.r, e.q, e.r, world.width) }))
            .filter(e => e.d > 0 && e.d <= 45 && walkTo(e)).sort((a, b) => a.d - b.d)[0];
        if (ex) return { q: ex.q, r: ex.r };
    }
    const near = nearest(world, player, settlementTiles(world), 6);
    // Among the towns nearest as the crow flies, one over the water: back to the
    // ship (laid up on this landmass) to sail, now and then — a walker can't get there
    if (Utils.random() < 0.5) {
        const laid = (player.ships || []).find(sh => sh.status === 'docked' && (sh.q !== player.q || sh.r !== player.r) && walkTo(sh));
        const overWater = laid && nearest(world, { q: player.q, r: player.r }, settlementTiles(world), 6).some(t => !walkTo(t));
        if (overWater) return { q: laid.q, r: laid.r, ship: true };
    }
    return near.length ? Utils.randPick(near) : null;
}

/**
 * Now and then lay siege to a weak town of a realm, and see it through:
 * a ram, terms after a few days, a storm with overwhelming odds, a relief
 * host fought or fled, and lifting the siege when the camp goes hungry.
 * Returns true while the army is camped before the walls.
 */
function siege(game, stats) {
    const { player, world } = game;
    if (!Sieges.active(player)) {
        const tile = world.getTile(player.q, player.r);
        const st = tile && tile.settlement;
        if (!st || !st.kingdom || st.type === 'capital' || player.gold < 1500 || player.getFoodCount() < 20) return false;
        if (PlayerMilitary.getArmyStrength(player) < 2 * PlayerMilitary.getSettlementDefense(st, world)) return false;
        if (Utils.random() > 0.05) return false;
        if (!Sieges.invest(player, world, tile).success) return false;
        count(stats, 'siegesLaid');
    }
    const s = Sieges.active(player);
    const d = Sieges.describe(player, world);
    count(stats, 'siegeDays');
    if (s.relief && s.relief.arrived) {
        if (d.army > s.relief.strength * 1.3) {
            const r = Sieges.fightRelief(player, world);
            count(stats, r.victory ? 'reliefsBeaten' : 'reliefLosses');
        } else if (Sieges.lift(player, world)) {
            count(stats, 'siegesLifted');
        }
        return !!Sieges.active(player);
    }
    if (s.hungryDays >= 2 || d.day > 30) {
        Sieges.lift(player, world);
        count(stats, 'siegesLifted');
        return false;
    }
    if (d.canParley && d.day >= 2) {
        const term = d.chances.surrender > 0.4 ? 'surrender' : d.chances.ransom > 0.3 ? 'ransom' : 'tribute';
        if (Sieges.negotiate(player, world, term).accepted) count(stats, 'siegeTerms');
    }
    if (Sieges.active(player) && d.day >= 3 && d.army >= d.defense * 2.5) {
        const r = Sieges.storm(player, world, { sack: Utils.random() < 0.2 });
        count(stats, r.victory ? 'siegesStormed' : 'stormsRepelled');
    }
    if (Sieges.active(player) && s.stance === 'blockade' && !s.works.ram && !s.building && player.gold > 1000) {
        if (Sieges.setStance(player, world, 'works', 'ram').success) count(stats, 'siegeWorks');
    }
    return !!Sieges.active(player);
}

/**
 * At war, in an enemy town with soldiers at its back: now and then harry it —
 * fire the fields, drive off the herds, burn the farmsteads, scatter the
 * peasants (never the slaughter). The realm's pursuit host that answers is met
 * as any war host is (the harness's encounters). Returns true when it harried.
 */
function harry(game, stats) {
    const { player, world } = game;
    if (Sieges.active(player) || player.health < 50) return false;
    const tile = world.getTile(player.q, player.r);
    if (!tile || !tile.settlement || !PlayerHarrying.available(player, world, tile)) return false;
    if (Utils.random() > 0.3) return false;
    const opts = PlayerHarrying.options(player, world, tile).filter(o => o.ok && o.id !== 'slaughter');
    const pick = ['fields', 'herds', 'torch', 'mill', 'scatter'].map(id => opts.find(o => o.id === id)).find(Boolean);
    if (!pick) return false;
    const r = PlayerHarrying.act(player, world, pick.id);
    if (!r.success) return false;
    count(stats, r.resisted ? 'harryResisted' : 'harried');
    if (r.pursuit) count(stats, 'harryPursued');
    return true;
}

/**
 * A holding under siege: march to relieve it when the army is strong enough
 * (and fight the host there), pay the enemy off when rich, send food when the
 * stores run low, and let the governor sally when the garrison outnumbers the
 * lines. Returns true while the army is on its way or fighting.
 */
function defendHoldings(game, stats) {
    const { player, world } = game;
    const sieges = HoldingSieges.list(player);
    if (!sieges.length) return false;
    count(stats, 'holdingSiegeDays');
    const s = sieges[0];
    const d = HoldingSieges.describe(player, world, s.key);
    if (!d) return false;
    if (d.army >= s.besiegers * 1.3 && !player.boardedShip && !Sieges.active(player) && d.distance <= 30) {
        if (d.canRelieve) {
            const r = HoldingSieges.relieve(player, world, s.key);
            count(stats, r.victory ? 'holdingsRelieved' : 'holdingReliefsBeaten');
            return true;
        }
        game.dest = { q: s.q, r: s.r };
        travelTo(game, s.q, s.r);
        count(stats, 'reliefMarches');
        return true;
    }
    if (player.gold >= d.buyOffPrice * 2) {
        if (HoldingSieges.buyOff(player, world, s.key).success) count(stats, 'holdingSiegesBoughtOff');
        return false;
    }
    if (s.stores < 5 && !s.convoys.length && Sieges._foodInPacks(player) >= 30) {
        if (HoldingSieges.sendSupplies(player, world, s.key, { via: 'caravan', food: 20 }).success) count(stats, 'holdingSupplies');
    }
    if (d.canSally && s.garrison > s.besiegers * 0.6) {
        if (HoldingSieges.sally(player, world, s.key).won) count(stats, 'holdingSallies');
    }
    return false;
}

/** Raise the children: a focus each, a cheap tutor when rich, answer their dilemmas. */
function family(game, stats) {
    const { player, world } = game;
    const focuses = Object.keys(Upbringing.focuses());
    (player.children || []).forEach((child, i) => {
        if (child.isAlive === false) return;
        const up = Upbringing.ensure(child);
        if (up.comeOfAge) {
            if (!child.isSibling) marryOff(game, child, up, stats);
            return;
        }
        if (!up.focus && focuses.length && Upbringing.setFocus(player, child.id, focuses[i % focuses.length], world).success) count(stats, 'focusesSet');
        if (!up.tutor && player.gold > 2500 && Upbringing.hireCourtTutor(player, world, child.id, 'hedge_tutor').success) count(stats, 'tutorsHired');
        const ev = Upbringing.pendingEvent(player, child);
        if (ev) {
            const pick = ev.choices.find(c => c.affordable && !c.risky) || ev.choices.find(c => c.affordable);
            if (pick && Upbringing.resolveEvent(player, world, child.id, pick.id).success) count(stats, 'childEvents');
        }
    });
}

/**
 * A grown child of the ruler's own is married off (systems/heirs.js) once in
 * a while: a match in town costs nothing, an alliance its dowry. A married
 * heir brings their spouse and their children to the seat
 * (Relationships._heirsOwnChildren), so the line goes on.
 */
function marryOff(game, child, up, stats) {
    const { player, world } = game;
    if (up.spouse || world.day % 30 !== 0 || child.age < 18) return;
    count(stats, 'childWedTried');
    // Know the folk of the towns nearby, as a player passing through them would
    for (const t of nearest(world, player, settlementTiles(world), 6)) {
        const s = (world.getTile(t.q, t.r) || {}).settlement;
        if (s && !s.folk) s.folk = Townsfolk.seed(s, world, { q: t.q, r: t.r });
    }
    // The match closest in age (the list leads with the folk the House knows)
    const match = Heirs.localMatches(player, world, child.id).sort((a, b) => Math.abs(a.age - child.age) - Math.abs(b.age - child.age))[0];
    if (match && Heirs.marryTownsperson(player, world, child.id, match.folk, match.person.id).success) {
        count(stats, 'childrenWed');
        return;
    }
    if (player.gold < Heirs.config().allianceDowry * 3) return;
    // The living realm that thinks best of the House (a fallen one can't wed anyone)
    const realms = (world.kingdoms || []).filter(k => k && k.isAlive && ((player.reputation || {})[k.id] || 0) >= Heirs.config().allianceMinReputation);
    realms.sort((a, b) => ((player.reputation || {})[b.id] || 0) - ((player.reputation || {})[a.id] || 0));
    const res = realms.length ? Heirs.marryForAlliance(player, world, child.id, realms[0].id) : null;
    if (res && res.success) count(stats, 'childrenWed');
    else count(stats, realms.length ? 'childWedRefused' : 'childWedNoRealm');
}

/**
 * The House's cadet branches (systems/cadetBranches.js): now and then a spare
 * grown child (never the heir, and only with another grown child kept home)
 * is sent out with a grant; a cooling branch gets a gift; at war, a loyal one
 * is asked for men.
 */
function cadets(game, stats) {
    const { player, world } = game;
    if (!player.house || world.day % 30 !== 0) return;
    const list = CadetBranches.list(player);
    const kids = CadetBranches.candidates(player, world).filter(c => !c.isSibling || list.length < 2);
    const grownHome = (player.children || []).filter(c => c && c.isAlive !== false && c.age >= 16);
    if (kids.length && grownHome.length >= 2 && list.length < 3 && world.day % 120 === 0) {
        const c = kids.sort((a, b) => b.age - a.age)[0];
        const grant = player.gold > 3000 ? Math.min(1000, Math.floor(player.gold * 0.1)) : 0;
        if (CadetBranches.found(player, world, c.id, { grant }).success) count(stats, 'cadetsFounded');
    }
    const cool = list.filter(b => b.loyalty < 45).sort((a, b) => a.loyalty - b.loyalty)[0];
    if (cool && player.gold > 2000 && CadetBranches.gift(player, world, cool.id, 300).success) count(stats, 'cadetGifts');
    if (RealmWars.wars(player).length) {
        const loyal = list.find(b => b.loyalty >= 55 && !CadetBranches.levyOf(player, b));
        if (loyal && CadetBranches.askMen(player, world, loyal.id).success) count(stats, 'cadetLevies');
    }
}

/**
 * A fight night at the town's pit (systems/pitFights.js): one evening in three
 * with a settled purse the bot puts a small stake (a fiftieth of the purse, 5–25g)
 * on the favourite of one bout and watches from the rail. It never steps into
 * the pit, never bets where the pit has gone underground (a raid's fine and heat),
 * and a long losing run puts it off for a season.
 */
function pitNight(game, tile, stats) {
    const { player, world } = game;
    const s = tile.settlement;
    if (!s || !s.folk || player.gold < 300 || frugal(game)) return;
    const pit = PitFights.ensure(world, s);
    const card = pit && !pit.underground ? PitFights.card(world, s) : null;
    if (!card || card.ran) return;
    const st = PitFights.state(player);
    if (st.offUntil > world.day) return;
    if (((world.day * 2654435761) >>> 0) % 3 !== 0) return;
    const men = card.bouts.filter(b => b.kind === 'men');
    const bout = men[men.length - 1] || card.bouts[0];
    const book = bout && PitFights.odds(world, s, bout);
    if (!book) return;
    const side = book.pA >= 0.5 ? 'a' : 'b';
    const stake = Math.max(5, Math.min(25, Math.floor(player.gold / 50)));
    const before = player.gold;
    if (PitFights.bet(player, world, s, bout.i, side, stake).success) count(stats, 'pitBets');
    if (PitFights.watch(player, world, s).success) count(stats, 'pitNights');
    // (a run of bad nights — down 100g at the pits — and the bot stays away a season)
    st.botNet = (st.botNet || 0) + (player.gold - before);
    if (st.botNet <= -100) { st.offUntil = world.day + 30; st.botNet = 0; }
}

/** A spendthrift's day in town: supper, a bath, the laundry or the valet at the best house there. */
function livingWell(game, tile, stats) {
    const { player, world } = game;
    if (player.gold < 60) return;
    const houses = Hospitality.listAt(world, player, player.q, player.r).filter(v => v.owner === 'npc');
    const best = houses.sort((a, b) => (b.stars || 0) - (a.stars || 0))[0];
    if (!best) return;
    for (const sid of ['fine_dining', 'valet', 'bathhouse', 'supper', 'bath', 'laundry']) {
        if (player.gold < 60) break;
        const res = Hospitality.buyService(world, player, best.id, sid);
        if (res && res.ok) count(stats, 'livedWell');
    }
}

/**
 * Courtship (ui/actionMenu/peopleScene.js): past the short soak's horizon, an
 * unwed bot with a settled purse courts someone of an age in town — a little
 * affection a visit — and proposes once it would be accepted (affection 70,
 * a 100-gold ring), so runs that span generations have heirs to play.
 */
const SUITORS = new WeakMap(); // player → the NPC id being courted (kept off the save)
function courtship(game, stats) {
    const { player, world } = game;
    if (player.spouse || world.day <= 150 || player.age < 18 || player.gold < temper(game).courtAt) return;
    const tile = world.getTile(player.q, player.r);
    if (!tile || !tile.settlement) return;
    let suitor = SUITORS.has(player) ? Relationships.getNPC(SUITORS.get(player)) : null;
    if (!suitor || suitor.isAlive === false || suitor.isMarried) {
        const fit = Relationships.getNPCsAtSettlement(tile, world, player).filter(n => n.isAlive !== false && !n.isMarried
            && n.gender && n.gender !== player.gender && n.age >= 18 && Math.abs(n.age - player.age) <= 12);
        if (!fit.length) return;
        suitor = Utils.randPick(fit);
        SUITORS.set(player, suitor.id);
    }
    const rel = Relationships.getRelationship(player, suitor.id);
    rel.affection = Math.min(100, (rel.affection || 0) + 4);
    if (rel.affection < 70) return;
    // (the ring is bought in town: the coin goes into its purse)
    PlayerCoin.pay(world, player, 100, tile.settlement);
    if (Relationships.marry(player, suitor.id, world).success) {
        count(stats, 'married');
        SUITORS.delete(player);
    }
}

/**
 * Rival Houses' agents (systems/rivalAgents.js): past the short soak's
 * horizon, ask around a town where they could have bought someone now and
 * then, and deal with those found out — turn them when rich, else expose them.
 * No dice of its own.
 */
export function rivalAgents(game, stats) {
    const { player, world } = game;
    if (!player.house || world.day <= 150) return;
    const st = RivalAgents.state(player);
    for (const a of RivalAgents.known(player).filter(x => !x.turned)) {
        const cost = RivalAgents.turnCost(player, a);
        if (player.gold > cost * 4 && RivalAgents.turn(player, world, a.id).success) count(stats, 'agentsTurned');
        else if (RivalAgents.expose(player, world, a.id).success) count(stats, 'agentsExposed');
    }
    if (world.day % 10 !== 0 || player.gold < 400) return;
    const here = world.getTile(player.q, player.r);
    if (!here || !here.settlement) return;
    const key = `${player.q},${player.r}`;
    const suspect = st.agents.some(a => !a.known && `${a.q},${a.r}` === key) || !!RivalAgents.towns(player, world, { lazy: false })[key];
    if (suspect && RivalAgents.inquire(player, world, player.q, player.r).success) count(stats, 'agentInquiries');
}

/**
 * A rival House's lord within a hex (systems/rivalHouses.js): match a grown
 * child into their House when the feud allows and the purse can stand the
 * dowry; else buy the feud down with a gift when rich and it runs hot; else
 * parley. A grudge-bearing temper insults them now and then instead.
 */
export function rivalHouses(game, stats) {
    const { player, world } = game;
    for (const u of RivalHouses.meetable(player, world)) {
        const rival = RivalHouses.rivalOfUnit(player, u);
        if (!rival || !rival.head || rival.metDay === world.day) continue;
        count(stats, 'rivalLordsMet');
        const M = RivalHouses.config().meet.match;
        const theirs = RivalHouses.matchableChildren(rival);
        const mine = (player.children || []).filter(c => c && c.isAlive !== false && !c.isSibling && c.upbringing && c.upbringing.comeOfAge && !c.upbringing.spouse);
        if (theirs.length && mine.length && (rival.feud || 0) <= M.maxFeud && player.gold > M.dowry * 3) {
            const c = mine[0];
            const t = theirs.find(x => x.gender !== c.gender);
            if (t && RivalHouses.proposeMatch(player, world, rival.kingdomId, c.id, t.idx).success) { count(stats, 'rivalMatches'); continue; }
        }
        const feud = rival.feud || 0;
        if (feud >= 40 && player.gold > RivalHouses.giftCost(rival) * 5) {
            if (RivalHouses.gift(player, world, rival.kingdomId).success) count(stats, 'rivalGifts');
        } else if (feud >= 15 && Utils.random() < 0.15 && personaOf(game).id === 'drifter') {
            if (RivalHouses.insult(player, world, rival.kingdomId).success) count(stats, 'rivalInsults');
        } else if (feud >= 15) {
            const r = RivalHouses.parley(player, world, rival.kingdomId);
            if (r.success) count(stats, r.ok ? 'rivalParleysWon' : 'rivalParleysLost');
        }
    }
}

/**
 * Blood feuds (systems/bloodFeuds.js), as a careful player would meet them:
 * once a week, buy off the hottest feud the House owes with the blood price
 * when the purse can stand it three times over (a refusal waits out the
 * cooldown); a feud with a rival House or a crown may end in a match instead;
 * and in a town the House holds, judge the townsfolk's own feuds.
 */
export function bloodFeuds(game, stats) {
    const { player, world } = game;
    if (world.day % 7 !== 5) return;
    const open = BloodFeuds.ofPlayer(world).filter(f => f.owes !== BloodFeuds.playerIndex(f)).sort((a, b) => b.heat - a.heat);
    count(stats, 'feudDaysOwed', open.length ? 1 : 0);
    for (const f of open) {
        const q = BloodFeuds.wergildQuote(world, player, f.id);
        if (q.ok && player.gold > q.price * 3) {
            const r = BloodFeuds.offerWergild(world, player, f.id);
            if (r.success) count(stats, r.accepted ? 'feudWergildPaid' : 'feudWergildRefused');
            if (r.success && r.accepted) count(stats, 'feudWergildGold', r.cost);
            break;
        }
        const m = f.sides[1 - BloodFeuds.playerIndex(f)].kind !== 'folk' ? BloodFeuds.marriageOptions(world, player, f.id) : null;
        if (m && m.ok && player.gold > 500 && BloodFeuds.proposeMarriage(world, player, f.id).success) { count(stats, 'feudMatches'); break; }
    }
    const here = world.getTile(player.q, player.r);
    if (here && here.settlement) {
        for (const j of BloodFeuds.judgeable(world, player, here.settlement).slice(0, 1)) {
            if (BloodFeuds.arbitrate(world, player, j.feud.id).success) count(stats, 'feudsJudged');
        }
    }
}

/** One day of the bot's play (before the harness ends the day). */
/**
 * The House's unfinished business (systems/houseQuests.js): a matter is settled
 * on reaching its town (the kindest way the purse allows — or, a month on and
 * unable to pay, declined to their face), and once a week the bot rides to the
 * nearest one within 16 hexes when it can pay, or when it has waited two months.
 */
/**
 * The Church's wars (systems/holyWars.js), as a player of the faith might
 * meet them: a crowned bot answers most calls to its crown (on the call's
 * last fortnight, refusing the rest); now and then — fed, hale and not broke,
 * the muster within a few weeks' road — it takes the cross, rides to the
 * muster and keeps near the front until the vow is served. A crusade letter
 * (systems/courtLetters.js crusade_call) is answered the same way.
 */
export function holyWarDay(game, stats) {
    const { player, world } = game;
    // The crown's answer, in the call's last fortnight
    for (const w of HolyWars.invitations(player, world)) {
        if (w.answerBy - world.day > 14) continue;
        const yes = Utils.random() < 0.7;
        if (HolyWars.answer(player, world, w.id, yes).success) count(stats, yes ? 'holyWarAnswered' : 'holyWarRefused');
    }
    const p = HolyWars.pstate(player);
    const c = p.cross;
    if (!c) {
        if (world.day % 7 !== 5) return;
        const fit = player.health >= 70 && player.getFoodCount() >= 8 && player.gold >= 120;
        const opt = fit ? HolyWars.crossOptions(player, world).find(o => o.ok) : null;
        const muster = opt ? HolyWars.musterOf(world, opt.war) : null;
        if (!muster || Hex.wrappingDistance(player.q, player.r, muster.q, muster.r, world.width) > 30) return;
        // (a letter asking for it, or the bot's own zeal now and then)
        const letter = CourtLetters.open(player).find(l => l.kind === 'crusade_call' && l.data && l.data.warId === opt.war.id);
        if (!letter && Utils.random() >= 0.35) return;
        const res = letter ? CourtLetters.answer(player, world, letter.id, 'take') : HolyWars.takeCross(player, world, opt.war.id);
        if (res.success) count(stats, letter ? 'crossTakenByLetter' : 'crossTaken');
        return;
    }
    // Under the cross: to the muster, then keep near it until the vow is served
    const C = HolyWars.config().cross;
    const d = Hex.wrappingDistance(player.q, player.r, c.muster.q, c.muster.r, world.width);
    if (c.arrived == null ? d > C.musterRange : d > C.frontRange) {
        if (travelTo(game, c.muster.q, c.muster.r)) count(stats, 'crusadeMarches');
    } else if (c.arrived != null) count(stats, 'crusadeDaysServed');
}

function houseBusiness(game, stats) {
    const { player, world } = game;
    const open = HouseQuests.open(player);
    if (!open.length) return;
    const order = ['pay', 'deliver', 'coin', 'plead', 'buy', 'ask', 'search'];
    for (const q of [...open]) {
        if (!HouseQuests.at(player, q)) continue;
        const opts = HouseQuests.options(world, player, q.id).filter(o => o.ok);
        let pick = order.map(id => opts.find(o => o.id === id)).find(Boolean);
        // Come all this way and unable to pay: say so, rather than leave the matter hanging until it lapses
        if (!pick && world.day - q.day > 30) pick = ['leave', 'refuse', 'defy'].map(id => opts.find(o => o.id === id)).find(Boolean);
        if (!pick) continue;
        const r = HouseQuests.act(world, player, q.id, pick.id);
        if (r.success) count(stats, 'houseQuestsSettled');
    }
    if (world.day % 7 !== 3) return;
    const near = HouseQuests.open(player)
        .filter(q => q.target && (q.price == null || player.gold > q.price * 2 || world.day - q.day > 60) && Hex.distance(player.q, player.r, q.target.q, q.target.r) <= 16)
        .sort((a, b) => Hex.distance(player.q, player.r, a.target.q, a.target.r) - Hex.distance(player.q, player.r, b.target.q, b.target.r))[0];
    if (near && travelTo(game, near.target.q, near.target.r)) count(stats, 'houseQuestTrips');
}

/**
 * The scaffold (systems/executions.js), as a player might use it: join a
 * realm's crowd in town on the day (now and then crying out for mercy), and
 * give the word on anyone left waiting in the cells a fortnight — the guilty
 * to a proclaimed rope (or the axe) where the law allows, the rest pardoned.
 */
export function scaffoldDay(game, stats) {
    const { player, world } = game;
    for (const e of Executions.crowdsAt(world, player.q, player.r)) {
        const how = Utils.random() < 0.2 ? 'mercy' : 'watch';
        if (Executions.attend(player, world, e.id, how).success) count(stats, how === 'mercy' ? 'scaffoldMercyCries' : 'scaffoldWatched');
    }
    const day = world.day || 0;
    for (const e of Executions.list(player).slice()) {
        if (e.proclaimed || day - (e.day || 0) < 14) continue;
        const place = e.guilty !== false ? Executions.places(player, world, e).find(p => p.ok) : null;
        const m = place ? Executions.methods(player, world, e, place).find(x => x.ok && !x.cruel) : null;
        if (m && Executions.proclaim(player, world, e.id, m.id, place.key).success) { count(stats, 'scaffoldProclaimed'); continue; }
        // Spared for the mines or the oar where the realm's law sends convicts (systems/penalLabour.js), else pardoned
        const labour = ['mines', 'galleys'].find(id => Executions.mercies(player, world, e).some(x => x.id === id && x.ok));
        if (labour && Executions.spare(player, world, e.id, labour).success) { count(stats, 'scaffoldCommuted'); continue; }
        if (Executions.spare(player, world, e.id, 'pardon').success) count(stats, 'scaffoldPardoned');
    }
    gibbetsDay(game, stats);
}

/**
 * The dead in your hands and the trophies (systems/gibbets.js), as a player might:
 * a great enemy's banner taken, a rebel's or a traitor's head over the gate of the
 * nearest seat, the rest given back to the kin; a trophy's envoys answered (the
 * price taken half the time, else sent away).
 */
export function gibbetsDay(game, stats) {
    const { player, world } = game;
    for (const b of Gibbets.bodies(player, world).slice()) {
        if (b.great && Gibbets.trophyOptions(player, world, b).find(o => o.id === 'trophy_banner' && o.ok)) {
            if (Gibbets.takeTrophy(player, world, b.id, 'trophy_banner').success) count(stats, 'trophiesTaken');
        }
        const show = (b.rebel || b.traitor || b.source === 'field') && Gibbets.displayOptions(player, world, b).find(o => o.ok);
        if (show && Gibbets.display(player, world, b.id, show.id).success) { count(stats, 'deadDisplayed'); continue; }
        if (Gibbets.returnBody(player, world, b.id).success) count(stats, 'bodiesReturned');
    }
    for (const h of Gibbets.trophies(player)) {
        if (!h.trophy.demand) continue;
        if (Utils.random() < 0.5 && Gibbets.returnTrophy(player, world, h.id, 'price').success) count(stats, 'trophiesReturned');
        else if (Gibbets.refuseDemand(player, world, h.id).success) count(stats, 'trophyDemandsRefused');
    }
}

/**
 * The House's court (player/trials.js), as a player might keep it: the cases
 * before its seats ruled each day — the unproven acquitted, the proven
 * sentenced in proportion to the crime, with the lash, the iron, the mines
 * and the oar where the realm's law has them (systems/penalLabour.js);
 * never the scaffold. The convicts then work the House's mines and oars.
 */
export function judgeDay(game, stats) {
    const { player, world } = game;
    const st = Trials.state(player);
    if (!st.cases.length) return;
    const WANT = { 1: ['fine', 'flog', 'stocks'], 2: ['flog', 'mines', 'stocks', 'fine'], 3: ['mines', 'galleys', 'brand', 'jail'], 4: ['galleys', 'mines', 'jail'] };
    for (const c of st.cases.slice()) {
        if (c.ordeal && c.ordeal.pending) continue;
        const ids = new Set(Trials.verdicts(world, c, player).map(v => v.id));
        const pick = c.proof <= 1 ? 'acquit' : (WANT[Math.min(4, Math.max(1, Math.round(c.severity || 2)))].find(id => ids.has(id)) || 'fine');
        const r = Trials.rule(player, world, c.id, pick);
        if (r.success) count(stats, `judged_${pick}`);
    }
}

/**
 * Broke and hungry in a town (a fresh heir of an empty House, a new life with
 * nothing): beg for alms — coppers and a loaf from the passers-by — then buy
 * bread. First thing in the day, before the House's business spends the AP.
 */
function begIfBroke(game, stats) {
    const { player, world } = game;
    const here = world.getTile(player.q, player.r);
    if (!here || !here.settlement || player.boardedShip || player.getFoodCount() > 2 || player.gold >= 50) return;
    booked(game, 'beg', () => {
        if ((player.actionPoints || 0) < Begging.config().ap) { count(stats, 'begNoAP'); return; }
        if (!Begging.canBeg(player, world, here.settlement).ok) return;
        player.actionPoints -= Begging.config().ap;
        const r = Begging.beg(player, world, here.settlement);
        count(stats, 'begged');
        if (r.gold > 0) count(stats, 'begGold', r.gold);
        if (r.bread > 0) count(stats, 'begBread', r.bread);
        if (player.gold >= 1) buyFood(game, here, stats);
    });
}

/**
 * Now and then (monthly, and every month until the first), set out for a delve on
 * purpose when fit for it — hale, fed for the road, not broke — so the depths don't
 * wait on the bot happening to stand on a site.
 */
function delveTrek(game, stats) {
    const { player, world } = game;
    const bad = game.unreachableSites || (game.unreachableSites = new Set());
    // A trek under way outlasts the errands that cut across it (a food run, a town's business)
    // for 60 days: the day's first steps go toward the site, and it is delved on arrival
    let trek = game.trek && world.day - game.trek.day <= 60 && Delves.isDelveSite(world.getTile(game.trek.q, game.trek.r))
        && !bad.has(`${game.trek.q},${game.trek.r}`) ? game.trek : null;
    if (!trek) game.trek = null;
    // (held in the cells — on remand for trial, or serving it — is not being stuck on the road:
    // the trek waits, its clock and its stuck-counts untouched)
    if (trek && player.jailState) { trek.day += 1; trek.lastFrom = null; return; }
    // (beaten back on the road there three times — a lair across the way: another site next month)
    if (trek && player.health < 50 && !trek.hurtDay) { trek.hurtDay = world.day; trek.fails = (trek.fails || 0) + 1; }
    if (trek && player.health >= 50) trek.hurtDay = null;
    if (trek && trek.fails >= 3) { (game.trekBeaten || (game.trekBeaten = {}))[`${trek.q},${trek.r}`] = world.day; game.trek = trek = null; game.lastTrek = -1e9; count(stats, 'delveTrekBeaten'); }
    // (broke with the packs running low: bread first — the trek is dropped for a town and work)
    if (trek && player.gold < 30 && player.getFoodCount() <= 10) { game.trek = trek = null; count(stats, 'delveTrekBroke'); }
    // (short of food for the way there and back: dropped for a town while the packs still carry it
    // there — seed-505 lives starved in the hills on a trek begun with five days' bread)
    if (trek && !player.boardedShip && !Delves.active(player) && (player.q !== trek.q || player.r !== trek.r) && !fedFor(game, trek.q, trek.r, 2)) {
        game.trek = trek = null;
        if (game.dest && game.dest.delve) game.dest = null;
        count(stats, 'delveTrekShort');
    }
    if (trek && player.health >= 50 && player.getFoodCount() >= 3 && !player.boardedShip && !Delves.active(player)) {
        const from = `${player.q},${player.r}`;
        // (the day's other errands walked it back to where it began yesterday three days running:
        // a seed-202 life went back and forth between a trek and a town for 17 days and starved)
        trek.still = trek.lastFrom === from ? (trek.still || 0) + 1 : 0;
        trek.lastFrom = from;
        if (trek.still >= 3) { bad.add(`${trek.q},${trek.r}`); game.trek = null; count(stats, 'delveTrekNoWay'); return; }
        travelTo(game, trek.q, trek.r);
        game.trekStepDay = world.day;
        // (no step taken toward it three days running: no way there from here)
        if (`${player.q},${player.r}` === from && !player.crossing && (player.q !== trek.q || player.r !== trek.r)) {
            trek.stuck = (trek.stuck || 0) + 1;
            if (trek.stuck >= 3) { bad.add(`${trek.q},${trek.r}`); game.trek = null; count(stats, 'delveTrekNoWay'); }
            return;
        }
        if (player.q === trek.q && player.r === trek.r) booked(game, 'delve', () => delve(game, stats));
        return;
    }
    if (world.day - (game.lastTrek ?? -1e9) < 30 || world.day < 45) return;
    if (player.health < 60 || player.getFoodCount() < 5 || player.gold < 50 || player.boardedShip || Delves.active(player)) return;
    if (game.dest && (game.dest.delve || game.dest.company)) return;
    game.lastTrek = world.day;
    if (game.delved && Utils.random() >= 0.3) return;
    const site = delveSite(game);
    // (not on a trek the packs can't carry there and back)
    if (site && !fedFor(game, site.q, site.r, 2)) { count(stats, 'delveTrekUnfed'); return; }
    if (site) { game.dest = site; game.trek = { ...site, day: world.day }; count(stats, 'delveTreks'); }
}

export function botDay(game, stats) {
    const { player, world } = game;
    // The House's unfinished business told since yesterday (systems/houseQuests.js), counted by kind
    const hqSeen = game._hqSeen || (game._hqSeen = new Set());
    for (const q of HouseQuests.open(player)) {
        const key = `${player.name}:${q.id}`;
        if (hqSeen.has(key)) continue;
        hqSeen.add(key);
        count(stats, 'houseQuestsOffered');
        count(stats, `hq_${q.kind}`);
    }
    // (monthly: the House's book full, or nothing in the world's memory to make a quest of)
    if (world.day % 30 === 0 && player.house) {
        if (HouseQuests.open(player).length >= HouseQuests.config().maxOpen) count(stats, 'hqFullMonths');
        else if (!HouseQuests.candidates(world, player).length) count(stats, 'hqBareMonths');
    }
    // Yesterday's finds (Discovery.processDay in the harness's endDay)
    if (game.discoveryDay && game.discoveryDay.found.length) count(stats, 'discovered', game.discoveryDay.found.length);
    // ...and yesterday's road: an escort paid on arrival, or failed
    for (const n of (game.caravanDay && game.caravanDay.notices) || []) {
        if (n.title === 'Escort Paid') count(stats, 'escortsPaid');
        else if (n.title === 'Escort Failed') count(stats, 'escortsFailed');
    }
    if (player.jailState) {
        // (bail is paid into the town, as the cell's own button pays it: player/prison.js)
        if (!booked(game, 'jail', () => leaveJail(game, stats))) {
            count(stats, 'jailDays');
            return;
        }
    }
    // Thirsty, the skins dry and no water here: to water first, whatever the day's errand —
    // the detour ran only on a journey, and a king whose road was shut stood four days on
    // one hex and died of thirst (seed 101, 2026-11-24)
    if (!Sieges.active(player) && waterDetour(game)) { count(stats, 'waterFirst'); return; }
    if (player.indenturedServitude) {
        if (player.indenturedServitude.canBuyFreedom && player.gold >= player.indenturedServitude.freedomCost) {
            PlayerMilitary.buyFreedom(player, world);
        }
        count(stats, 'servitudeDays');
        return;
    }
    // A realm's ultimatum: pay the tribute when it leaves a purse to live on,
    // as a cautious player would, rather than let it come to war
    for (const u of Object.values((player.realmWars && player.realmWars.ultimatums) || {})) {
        if (!u) continue;
        if (player.gold >= u.tribute * 2) {
            if (RealmWars.payTribute(player, world, u.kingdomId).success) count(stats, 'tributesPaid');
        } else count(stats, 'ultimatumDaysUnpaid');
    }
    // The quest board: once settled in (past the short soak's horizon, whose
    // runs stay as they were), take the first offer each week while there's room
    if (world.day > 150 && world.day % 7 === 0 && player.quests && player.quests.active.length < 3 && (player.quests.available || []).length) {
        if (Quests.acceptQuest(player, player.quests.available[0].id, world).success) count(stats, 'questsAccepted');
    }
    begIfBroke(game, stats);
    // (a town that sells bread: the packs topped up before any road)
    stockUp(game, stats);
    delveTrek(game, stats);
    if (world.day > 150 && !player.boardedShip && !Ships.getVoyage(player)) houseBusiness(game, stats);
    if (!player.boardedShip && !Ships.getVoyage(player)) holyWarDay(game, stats);
    if (!player.boardedShip && !Ships.getVoyage(player)) scaffoldDay(game, stats);
    // (captives taken on the road yesterday, ransom talks, your men held)
    prisonersDay(game, stats);
    judgeDay(game, stats);
    if (Ships.getVoyage(player)) {
        voyageDay(game, stats);
        return;
    }
    if (player.boardedShip) {
        seaHolds(game, stats);
        discoveries(game, stats);
        // Out at sea after an expedition: search the waters before heading in
        if (Ships.isWaterTile(world.getTile(player.q, player.r)) && Utils.random() < 0.5) {
            const res = Discovery.exploreOcean(player, player.boardedShip, world);
            if (res && res.discovery) count(stats, 'discoveredExploring');
        }
        const t = world.getTile(player.q, player.r);
        if (t && t.terrain.passable) Ships.disembark(player, world);
        else {
            // Hove to on open water: plot a voyage home to the nearest port (or
            // hand-sail there if no voyage can be plotted), or row ashore
            const port = Ships.seaRoutes(world, player.q, player.r)[0];
            if (port && Ships.startVoyage(player, world, player.boardedShip, port.q, port.r, port.name).success) {
                count(stats, 'madeForPort');
                return;
            }
            if (port) travelTo(game, port.q, port.r);
            const here = world.getTile(player.q, player.r);
            if (here && here.terrain.passable) Ships.disembark(player, world);
            else {
                const shore = Ships.getRowAshoreTargets(world, player.q, player.r)[0];
                if (shore && Ships.rowAshore(player, world, shore.q, shore.r).success) count(stats, 'rowedAshore');
            }
            if (player.boardedShip) return;
        }
    }

    // Saving for the company (companyTarget): soldiers' wages would eat what the
    // labour earns, so pay them off (not in the middle of a siege)
    // (a realm's guard riding with the player is the crown's to pay, not the purse's: player/realmEscort.js —
    // the bot paid a king's household guard off every morning it was short, and rode out alone)
    const paid = (player.army || []).filter(u => u && u.realmGuard == null);
    if (frugal(game) && paid.length && !Sieges.active(player)) {
        player.army = player.army.filter(u => !paid.includes(u));
        count(stats, 'disbandedToSave');
    }
    // Broke: pay off soldiers and sailors rather than starve
    if (player.gold < 150 && paid.length > 2) {
        const off = new Set(paid.slice(0, Math.ceil(paid.length / 2)));
        player.army = player.army.filter(u => !off.has(u));
        count(stats, 'disbanded');
    }
    // Broke: let the spies and paid companions go too — wages can't come before bread
    if (player.gold < 150) {
        for (const spy of [...((player.espionage && player.espionage.spies) || [])]) {
            if (Espionage.dismissSpy(player, spy.id)) count(stats, 'spiesDismissed');
        }
        for (const id of [...(player.travelParty || [])]) {
            const npcId = typeof id === 'object' ? id.id : id;
            if (Companions.dismiss(player, npcId, world).success) count(stats, 'companionsDismissed');
        }
        // ...and the clients whose stipends it can't carry
        for (const c of Patronage.state(player).clients.slice()) {
            if (Patronage.dismiss(player, world, c.id).success) count(stats, 'clientsDismissed');
        }
        // ...and sell a ship whose upkeep and wages the purse can't carry
        const docked = (player.ships || []).find(s => s.status === 'docked');
        if (docked && Ships.sellShip(player, docked.id, world).success) count(stats, 'shipsSold');
        // (no buyer at her port: pay the crew off, whose wages bleed a thin purse dry)
        else if (docked && (docked.crew || 0) > 0 && Ships.dismissCrew(player, docked.id, docked.crew).success) count(stats, 'crewPaidOff');
    }
    // A thinning purse (under 400, no company to feed): a laid-up ship's upkeep and wages
    // bled a seed-202 life to starvation in a dear-bread town — sell her before it comes to that
    else if (player.gold < 400 && !MerchantHouses.company(player) && !player.boardedShip) {
        const docked = (player.ships || []).find(s => s.status === 'docked');
        if (docked && Ships.sellShip(player, docked.id, world).success) count(stats, 'shipsSold');
        // (no buyer at her port: pay the crew off and lay her up — a quarter of her upkeep)
        else if (docked && (docked.crew || 0) > 0 && Ships.dismissCrew(player, docked.id, docked.crew).success) count(stats, 'laidUp');
    }
    // A crowned ruler: the palace larder, and home to it when the packs run low (keepCourt)
    if (booked(game, 'keepCourt', () => keepCourt(game, stats))) return;
    // Running out of food with money in the purse: make for the nearest town and buy some
    // (one that had food the last time it was tried: a dawn village picked bare is no use)
    const foodless = game.foodlessAt || (game.foodlessAt = {});
    const stocked = (t) => !(world.day - (foodless[`${t.q},${t.r}`] ?? -1e9) < 20);
    let cantBuy = false;
    // (on campaign for a crown — a claim's civil war, its villages picked bare — the packs are
    // filled sooner: a king in the field at four days' food starved between bare villages)
    // (and so in a dearth — a town found bare these thirty days: the next is likely bare too,
    // and lives with 2,000 gold starved walking between a bare town and the hex beside it)
    const dearth = world.day - (game.lastBareDay ?? -1e9) < 30;
    const foodRunAt = Throne.state(player).civilWar || dearth ? 8 : 4;
    if (player.getFoodCount() <= foodRunAt && player.gold >= 30 && !player.boardedShip) {
        const at = world.getTile(player.q, player.r);
        if (at && at.settlement) {
            booked(game, 'buyFood', () => buyFood(game, at, stats));
            const before = player.getFoodCount();
            // (bare: no bread or grain on its stalls at all — a town the bot merely can't
            // afford more of is not bare, and walking off from it on a thin purse kills)
            const bare = stallFood(at.settlement) < STALL_ENOUGH;
            if (bare) game.lastBareDay = world.day;
            if (before <= foodRunAt && bare) {
                // (nothing on the stalls here: with a few days' food left, walk on to the
                // next town that had some, rather than sit in a bare town until it is gone)
                foodless[`${player.q},${player.r}`] = world.day;
                // (a market with bread on its stalls first, when the packs reach it: in a dearth the
                // nearest town not yet tried is bare too, and a king of 24 towns with 9,000 gold
                // walked from one bare town to the next until he starved — seed 303 2026-11-24)
                const mk = before >= 1 ? marketNear(game) : null;
                const mkDays = mk ? tripDays(game, mk.q, mk.r) : null;
                const next = mk && mkDays != null && mkDays <= before + 2 ? mk
                    : before >= 1 ? nearest(world, player, settlementTiles(world).filter(stocked), 1)[0] : null;
                // (in days on the road, not hexes: a hill hex is a day and a half, a highland two)
                const days = next ? tripDays(game, next.q, next.r) : null;
                if (next && days != null && days <= before + 2) {
                    game.dest = { q: next.q, r: next.r };
                    // (held to on the road: the morning's food run goes on there — stick)
                    game.headingTo = { q: next.q, r: next.r, day: world.day };
                    travelTo(game, next.q, next.r);
                    const now = world.getTile(player.q, player.r);
                    if (now && now.settlement) booked(game, 'buyFood', () => buyFood(game, now, stats));
                    count(stats, 'foodRuns');
                    return;
                }
                if (before <= 2) cantBuy = true;
            } else if (before <= 2) {
                // (food here but not for this purse: as before, live off the land a day)
                foodless[`${player.q},${player.r}`] = world.day;
                cantBuy = true;
            }
            // The last meal gone in a bare town: off to the nearest market with bread, however
            // far, rather than forage about it until it kills
            if (cantBuy && before <= 1 && bare) {
                const m = marketNear(game);
                if (m) {
                    game.dest = { q: m.q, r: m.r };
                    game.headingTo = { q: m.q, r: m.r, day: world.day };
                    travelTo(game, m.q, m.r);
                    const now = world.getTile(player.q, player.r);
                    if (now && now.settlement) booked(game, 'buyFood', () => buyFood(game, now, stats));
                    count(stats, 'starvingToMarket');
                    return;
                }
            }
        } else {
            // (a market with bread on its stalls first, when one is a short walk: a bare village
            // nearer is no help to empty packs)
            // (seed 303 2026-11-24: in every season, not only on campaign — see the bare-town run above)
            const market = marketNear(game);
            let town = market && (tripDays(game, market.q, market.r) ?? 99) <= player.getFoodCount() + 2 ? market
                : stick(game, nearest(world, player, settlementTiles(world).filter(stocked), 6));
            // (the packs at their last meals and the town days further off than they and a few
            // hungry days last: forage or hunt the day here instead — a starving walker's day
            // shrinks to a fraction of a hex, and lives died on the way, a little nearer each day)
            const left = player.getFoodCount();
            if (town && left <= 2 && !Delves.active(player) && (tripDays(game, town.q, town.r) ?? 99) > left + 3) {
                // (a nearer town found bare a while ago may have bread again, and has alms and work)
                // (not one found bare these last days: back to an empty market starved lives)
                const any = nearest(world, player, settlementTiles(world).filter(t => !(world.day - (foodless[`${t.q},${t.r}`] ?? -1e9) < 5)), 1)[0];
                town = any && (tripDays(game, any.q, any.r) ?? 99) <= left + 3 ? any : null;
                // (but once the packs are empty and hunger bites, staying is death: walk for the
                // nearest market with bread on its stalls, however far — a king with 5,000g starved
                // foraging a day from a bare village, seed 101 2026-11-24)
                if (!town && left === 0 && ((player.starvationDays || 0) >= 1 || (player.health || 0) < 95)) { town = marketNear(game); if (town) count(stats, 'starvingToMarket'); }
                if (!town) count(stats, 'foragedShort');
            }
            if (!town) cantBuy = true;
            if (town) {
                game.dest = { q: town.q, r: town.r };
                const from = `${player.q},${player.r}`;
                travelTo(game, town.q, town.r);
                // No road to any town (an island landing): row back out to the anchored ship
                const anchored = (player.ships || []).find(s => s.status === 'anchored' && Hex.distance(s.q, s.r, player.q, player.r) <= 1);
                if (from === `${player.q},${player.r}` && !player.crossing && anchored && Ships.rowToShip(player, anchored.id).success) count(stats, 'rowedToShip');
                const now = world.getTile(player.q, player.r);
                if (now && now.settlement) booked(game, 'buyFood', () => buyFood(game, now, stats));
                count(stats, 'foodRuns');
                // No way there: that town is no help today — off to find food in the wild
                if (from === `${player.q},${player.r}` && !player.boardedShip && !player.crossing) {
                    foodless[`${town.q},${town.r}`] = world.day;
                    game.dest = null;
                    cantBuy = true;
                } else {
                    return;
                }
            }
        }
    }
    // Broke out in the country with the packs running low: make for the nearest town while
    // there is food for the road — a day's work or alms there buys bread; the wild may not
    const atNow = world.getTile(player.q, player.r);
    if (!cantBuy && player.gold < 30 && player.getFoodCount() >= 1 && player.getFoodCount() <= 6 && !player.boardedShip
        && !(atNow && atNow.settlement) && !Delves.active(player)) {
        const town = stick(game, nearest(world, player, settlementTiles(world).filter(stocked), 6));
        if (town && town.d <= Math.max(2, player.getFoodCount() * 2)) {
            const from = `${player.q},${player.r}`;
            game.dest = { q: town.q, r: town.r };
            travelTo(game, town.q, town.r);
            if (from !== `${player.q},${player.r}`) {
                count(stats, 'brokeToTown');
                const now = world.getTile(player.q, player.r);
                if (now && now.settlement && (player.actionPoints || 0) >= JOB_AP) booked(game, 'labour', () => dayLabour(game, now, stats));
                if (now && now.settlement) booked(game, 'buyFood', () => buyFood(game, now, stats));
                return;
            }
        }
    }
    // Low on food and none to be had for money (broke, or nothing on the stalls
    // — a dawn village sells little): live off the land like anyone would —
    // step out of town onto forageable ground and forage or hunt the day there
    const forage = DataLoader.earlyJobs && DataLoader.earlyJobs.foraging;
    let lowFood = player.gold < 20 ? player.getFoodCount() === 0 : player.getFoodCount() <= 2 && cantBuy;
    // In a town with bread on its stalls but none for this purse: a day's wage buys it.
    // Walking out to forage crosses a hex of days on an empty belly (lives starved so).
    const inTown = world.getTile(player.q, player.r);
    if (lowFood && inTown && inTown.settlement && stallFood(inTown.settlement) >= STALL_ENOUGH) {
        if ((player.actionPoints || 0) >= JOB_AP) booked(game, 'labour', () => dayLabour(game, inTown, stats));
        booked(game, 'buyFood', () => buyFood(game, inTown, stats));
        if (player.getFoodCount() > 0) { count(stats, 'workedForBread'); lowFood = false; }
    }
    if (lowFood && forage && !player.boardedShip) {
        // Ground where something edible grows (bare hills give only stone)
        const edible = (t) => {
            const table = t && !t.settlement && t.terrain.passable && Foraging.lootTableFor(t, forage);
            return !!table && table.some(e => player.constructor.FOOD_TYPES.includes(e.item));
        };
        let here = world.getTile(player.q, player.r);
        if (!edible(here)) {
            let spot = null;
            for (let r = 1; r <= 5 && !spot; r++) {
                for (let dq = -r; dq <= r && !spot; dq++) {
                    for (let dr = -r; dr <= r && !spot; dr++) {
                        const t = world.getTile(Hex.wrapQ(player.q + dq, world.width), player.r + dr);
                        if (t && edible(t)) spot = t;
                    }
                }
            }
            if (spot) travelTo(game, spot.q, spot.r);
            here = world.getTile(player.q, player.r);
        }
        if (!here.settlement) {
            // Hunt where there is game worth eating (more meat than a forager's handful), else forage
            const hunt = DataLoader.earlyJobs.hunting;
            const cat = forage.terrain_mapping && forage.terrain_mapping[here.terrain.id];
            const prey = hunt && hunt.loot_table && cat ? hunt.loot_table[cat] : null;
            if (prey && prey.some(e => player.constructor.FOOD_TYPES.includes(e.item)) && Utils.random() < 0.5) {
                const h = Hunting.quickHunt(player, prey);
                if (h.success && h.added) count(stats, 'hunted');
            } else {
                const f = Foraging.quickForage(player, here, forage);
                if (f.success && f.added) count(stats, 'foraged');
            }
            return;
        }
        // (still on the way out of town to the foraging ground: the day is the walk there —
        // an errand after it set out elsewhere, gave up the crossing, and the life starved in town)
        if (player.crossing) { count(stats, 'toForage'); return; }
    }
    if (player.needs && player.needs.hunger < 60 && player.getFoodCount() > 0) player.eatMeal();
    booked(game, 'courtship', () => courtship(game, stats));
    if ((player.children || []).length) family(game, stats);
    booked(game, 'cadets', () => cadets(game, stats));
    booked(game, 'rivalAgents', () => rivalAgents(game, stats));
    booked(game, 'rivalHouses', () => rivalHouses(game, stats));
    booked(game, 'bloodFeuds', () => bloodFeuds(game, stats));
    // Badly hurt: get to a town, see a physician and rest there (a pauper
    // can't pay one; better to go and live off the land)
    if (player.health < 50) {
        const here = world.getTile(player.q, player.r);
        if (here && here.settlement) {
            if (player.getFoodCount() < 5) booked(game, 'buyFood', () => buyFood(game, here, stats));
            if (player.needs && player.needs.hunger < 60 && player.getFoodCount() > 0) player.eatMeal();
            for (const o of Ailments.treatmentOptions(player, world, here.settlement)) {
                const res = o.can ? Ailments.treat(player, world, here.settlement, o.key) : null;
                if (res && res.success) count(stats, res.charity ? 'treatedForCharity' : 'treated');
            }
            // A pauper cannot lie abed: hurt or not, the day's wage buys the bread
            if (player.gold < poorBelow(game)) {
                booked(game, 'labour', () => dayLabour(game, here, stats));
                count(stats, 'workedHurt');
                return;
            }
            // Nothing to eat for sale here (a hamlet picked bare): move on to the
            // next town rather than starve while resting
            if (player.getFoodCount() === 0 && player.gold >= 50) {
                const next = nearest(world, player, settlementTiles(world), 3)[0];
                if (next) {
                    game.dest = { q: next.q, r: next.r };
                    travelTo(game, next.q, next.r);
                    const now = world.getTile(player.q, player.r);
                    if (now && now.settlement) booked(game, 'buyFood', () => buyFood(game, now, stats));
                    count(stats, 'foodRuns');
                    return;
                }
            }
            count(stats, 'convalescing');
            return;
        }
        const town = stick(game, nearest(world, player, settlementTiles(world), 3));
        if (town) {
            game.dest = { q: town.q, r: town.r };
            travelTo(game, town.q, town.r);
            return;
        }
    }
    // Sick in a town with money to spare: see the physician, as a player would
    // before a fever or the flux reaches its deadly stage, or a wound festers
    const dangerous = (rec) => {
        if (!rec) return false;
        if (rec.kind === 'wound') return !!rec.infected;
        const def = Ailments.def(rec.id);
        return !!(def && def.stages && (def.stages[rec.stage] || {}).deathChance > 0);
    };
    const sickAt = world.getTile(player.q, player.r);
    if (sickAt && sickAt.settlement) {
        for (const opt of Ailments.treatmentOptions(player, world, sickAt.settlement)) {
            if ((opt.kind !== 'disease' && opt.kind !== 'wound') || !opt.can) continue;
            // A dangerous condition is paid for whatever the purse (or taken as charity)
            if (!dangerous(Ailments.list(player).find(a => a.key === opt.key))) continue;
            if (booked(game, 'medicine', () => Ailments.treat(player, world, sickAt.settlement, opt.key)).success) count(stats, 'treated');
        }
    } else if (Ailments.list(player).some(dangerous)) {
        // Out on the road with a festering wound or a dangerous fever: make for a physician
        const town = stick(game, nearest(world, player, settlementTiles(world), 3));
        if (town) {
            game.dest = { q: town.q, r: town.r };
            travelTo(game, town.q, town.r);
            count(stats, 'soughtPhysician');
            return;
        }
    }
    // The company savings plan come good: found it before anything else (soldiers,
    // a claim, a venture) spends the sum
    const plan = companyTarget(game);
    if (plan && savings(player) >= plan) {
        const here = world.getTile(player.q, player.r);
        if (here && here.settlement) booked(game, 'company', () => company(game, here, stats));
    }
    // Saving for the company with the charter's price in hand: on the road to the plan's
    // crown to buy it (company() set the way), then back to saving the capital
    const cp = game.companyPlan;
    if (plan && savings(player) < plan && game.dest && game.dest.company && cp && !MerchantHouses.hasCharter(player)
        && !MerchantHouses.officeCharter(player) && player.gold >= (cp.charter || 0) + 250 && !player.boardedShip) {
        const from = `${player.q},${player.r}`;
        travelTo(game, game.dest.q, game.dest.r);
        if (`${player.q},${player.r}` === from && !player.crossing) {
            (game.unreachableSites || (game.unreachableSites = new Set())).add(`${game.dest.q},${game.dest.r}`);
            game.dest = null;
        } else {
            count(stats, 'travelDays');
            settlementBusiness(game, stats);
            return;
        }
    }
    // Poor: earn a living before anything grand — a day's labour and the
    // market in town, as a player starting with a light purse would
    if (player.gold < poorBelow(game) && !(player.army || []).length) {
        const here = world.getTile(player.q, player.r);
        // A town whose employers could not pay the day's wages lately is no place
        // to earn bread (three lives starved labouring for nothing in one): move on
        const broke = (t) => world.day - ((game.brokeTowns || {})[`${t.q},${t.r}`] ?? -1e9) < 30;
        // (a ruler at court stays: the royal kitchens feed it there — Household.royalTable)
        const atCourt = (() => { const st = royalSeat(game); return !!st && st.q === player.q && st.r === player.r; })();
        if (here && here.settlement && broke(here) && !atCourt) {
            const next = nearest(world, player, settlementTiles(world), 6).find(t => !broke(t));
            if (next && fedFor(game, next.q, next.r)) {
                const from = `${player.q},${player.r}`;
                game.dest = { q: next.q, r: next.r };
                travelTo(game, next.q, next.r);
                if (`${player.q},${player.r}` !== from) { count(stats, 'leftBrokeTown'); return; }
            }
        }
        if (here && here.settlement) {
            booked(game, 'labour', () => dayLabour(game, here, stats));
            if (player.getFoodCount() < 5) booked(game, 'buyFood', () => buyFood(game, here, stats));
            settlementBusiness(game, stats);
            return;
        }
        // (a town it found no way into lately is passed over: a life sat a hex from one
        // for ten days, mauled by the beasts there, trying the same way each morning)
        const noWay = (t) => world.day - ((game.noWayTo || {})[`${t.q},${t.r}`] ?? -1e9) < 30;
        const near = nearest(world, player, settlementTiles(world), 6).filter(t => !noWay(t));
        let town = near.find(t => !broke(t)) || near[0];
        // (the packs too light for the road to it: the nearest town, broke or not, bread first)
        if (town && near[0] && town !== near[0] && !fedFor(game, town.q, town.r)) town = near[0];
        town = stick(game, near, town);
        if (town) {
            const from = `${player.q},${player.r}`;
            const fresh = (player.movementRemaining || 0) > 0;
            game.dest = { q: town.q, r: town.r };
            travelTo(game, town.q, town.r);
            if (fresh && `${player.q},${player.r}` === from && !player.crossing) {
                (game.noWayTo || (game.noWayTo = {}))[`${town.q},${town.r}`] = world.day;
                game.dest = null;
                count(stats, 'poorNoWay');
            }
            return;
        }
    }
    if (booked(game, 'holdingSieges', () => defendHoldings(game, stats))) return;
    if (booked(game, 'siege', () => siege(game, stats))) return;
    if (booked(game, 'harry', () => harry(game, stats))) return;
    booked(game, 'court', () => court(game, stats));
    booked(game, 'stewards', () => stewards(game, stats));
    booked(game, 'throne', () => throne(game, stats));
    booked(game, 'treasures', () => treasures(game, stats));
    settlementBusiness(game, stats);
    booked(game, 'delve', () => delve(game, stats));
    booked(game, 'fight', () => fight(game, stats));
    booked(game, 'outlaws', () => outlaws(game, stats));

    booked(game, 'discoveries', () => discoveries(game, stats));
    const tile = world.getTile(player.q, player.r);
    // A spendthrift lives well in town while the purse allows
    if (tile && tile.settlement && temper(game).spends) booked(game, 'livingWell', () => livingWell(game, tile, stats));
    // A fight night at the town pit: now and then a small bet on the favourite, from the rail (never into the sand)
    if (tile && tile.settlement) booked(game, 'pitFights', () => pitNight(game, tile, stats));
    // Grand ventures, for a temperament that risks them with what's saved
    // (not while saving for the company, or on the road to its charter)
    const venturing = player.gold >= temper(game).ventureAt && !frugal(game);
    if (venturing && tile && tile.settlement && booked(game, 'expedition', () => expedition(game, tile, stats))) return;
    if (venturing && tile && tile.settlement && booked(game, 'sail', () => sail(game, tile, stats))) {
        settlementBusiness(game, stats);
        return;
    }
    if (venturing && booked(game, 'colony', () => foundColony(game, stats))) return;
    if (venturing && booked(game, 'caravans', () => caravans(game, stats))) return;

    // A delve site is held to until reached; other destinations drift
    // (at a delve site too hurt to go in: rest by it a day or two while fed, rather than leave it)
    const atSite = game.dest && game.dest.delve && game.dest.q === player.q && game.dest.r === player.r;
    if (atSite && player.health < 50 && player.getFoodCount() >= 2 && Delves.isDelveSite(world.getTile(player.q, player.r))) {
        count(stats, 'delveRested');
        return;
    }
    if (!game.dest || (game.dest.q === player.q && game.dest.r === player.r) || (Utils.random() < 0.05 && !game.dest.delve && !game.dest.company)) {
        game.dest = chooseDestination(game);
    }
    // Not out of a town on a road longer than the packs: a day's work here instead, and
    // the bread it buys (lives left towns with two days' bread for a hex of three and starved)
    const leaving = game.dest && tile && tile.settlement && !player.boardedShip && (game.dest.q !== player.q || game.dest.r !== player.r);
    if (leaving && !fedFor(game, game.dest.q, game.dest.r)) {
        if ((player.actionPoints || 0) >= JOB_AP) booked(game, 'labour', () => dayLabour(game, tile, stats));
        booked(game, 'buyFood', () => buyFood(game, tile, stats));
        if (!fedFor(game, game.dest.q, game.dest.r)) {
            game.dest = null;
            count(stats, 'stayedUnfed');
            settlementBusiness(game, stats);
            return;
        }
    }
    if (game.dest) {
        const from = `${player.q},${player.r}`;
        travelTo(game, game.dest.q, game.dest.r);
        // No way there (another island, or beyond the pathfinder's reach): pick again
        // (a day spent part-way across a hex of days is progress: travel by days per hex, data/travel.json)
        // (the trek already took today's steps toward a delve site: standing still now is the day spent, not no way there)
        if (`${player.q},${player.r}` === from && !player.crossing && !(game.dest.delve && game.trekStepDay === world.day)) {
            if (game.dest.delve || game.dest.company) (game.unreachableSites || (game.unreachableSites = new Set())).add(`${game.dest.q},${game.dest.r}`);
            game.dest = null;
            count(stats, 'unreachable');
        }
        count(stats, 'travelDays');
        settlementBusiness(game, stats);
        booked(game, 'delve', () => delve(game, stats));
    }
}
