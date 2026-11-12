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
import { PlayerEconomy, Trading } from '../../player/playerEconomy.js';
import { PlayerMilitary } from '../../player/playerMilitary.js';
import { Treasures } from '../../player/treasures.js';
import { SeasonalWork } from '../../player/seasonalWork.js';
import { Foraging, Hunting } from '../../player/foraging.js';
import { DataLoader } from '../../core/dataLoader.js';
import { OddJobs } from '../../player/oddJobs.js';
import { Relationships } from '../../systems/relationships.js';
import { Ships } from '../../systems/ships.js';
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
import { Ailments } from '../../systems/ailments.js';
import { Sieges } from '../../systems/sieges.js';
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
import { Languages } from '../../systems/languages.js';
import { Commissions } from '../../systems/commissions.js';
import { Stewards } from '../../systems/stewards.js';
import { travelTo } from './harness.js';
import { HouseQuests } from '../../systems/houseQuests.js';

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
        const reachable = new Set(settlementTiles(world).filter(t => !(game.unreachableSites && game.unreachableSites.has(`${t.q},${t.r}`)))
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
const JOB_AP = 4;

function count(stats, key, n = 1) {
    stats[key] = (stats[key] || 0) + n;
}

/** Run a bot step and book its gold change to the game ledger under `label`. */
function booked(game, label, fn) {
    const before = game.player.gold;
    const out = fn();
    const d = game.player.gold - before;
    if (d && Number.isFinite(d)) {
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

function nearest(world, from, list, n = 6) {
    return list
        .map(t => ({ ...t, d: Hex.wrappingDistance(from.q, from.r, t.q, t.r, world.width) }))
        .filter(t => t.d > 0)
        .sort((a, b) => a.d - b.d)
        .slice(0, n);
}

// ── Settlement business ─────────────────────────────────────

function buyFood(game, tile, stats) {
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
    // once starved in a town of cheese and meat with gold in the purse)
    if (player.getFoodCount() > 2) return;
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
    for (const [id, qty] of Object.entries({ ...player.inventory })) {
        if (FOOD.includes(id) || !(qty > 0) || id === 'gold') continue;
        // Bullion bought for a mint is carried there (chooseDestination), not sold in passing
        if (BULLION.includes(id) && !crowded && player.gold >= 300) continue;
        if (FOOD_FALLBACK.includes(id) && player.getFoodCount() <= 10) continue;
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
        const bm = Underworld.sellBlackMarket(player, world, tile, id, qty);
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
        if (target) {
            if (savings(player) < target) return;
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
    if (!Ships.isPortTile(world, tile.q, tile.r) || Utils.random() > 0.25) return false;
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

/** A day at sea on a voyage: answer any event, sometimes heave to. */
function voyageDay(game, stats) {
    const { player, world } = game;
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
        if (armyStrength > 0 && Utils.random() < 0.4) {
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
    for (const office of Kingship.OFFICES) {
        if (court.council[office]) continue;
        const best = Kingship.candidates(player, world, office).find(c => !c.office);
        if (best && Kingship.appoint(player, world, office, best.kind, best.id).success) count(stats, 'councilAppointed');
    }
    // Keep the crown's books (systems/fiscal.js): a player's crown never
    // reviews its own taxes, so a ruler who never looks runs the chests dry
    const ruled = Throne.ruledKingdom(player, world);
    if (ruled && world.day % 7 === 0) {
        const f = CrownBooks.state(ruled);
        const days = Fiscal.reserveDays(ruled);
        const levels = ['light', 'standard', 'heavy', 'crushing'];
        const cur = Math.max(0, levels.indexOf(f.level));
        const stab = typeof ruled.stability === 'number' ? ruled.stability : 60;
        let want = cur;
        if (days < 15 && stab > 30) want = Math.min(2, cur + 1);
        else if (days > 90 || stab < 25) want = Math.max(0, cur - 1);
        if (want !== cur && Fiscal.setRate(player, world, 'all', levels[want]).success) count(stats, 'crownTaxSet');
        const court = days < 10 ? 'frugal' : days > 120 ? 'lavish' : 'standard';
        if (court !== f.courtLevel && Fiscal.setCourt(player, world, court).success) count(stats, 'crownCourtSet');
        const pay = f.arrearsDays > 0 && days < 4 ? 'half' : 'full';
        if (pay !== f.armyPay && Fiscal.setArmyPay(player, world, pay).success) count(stats, 'crownPaySet');
    }
    // (edicts only from a treasury with a cushion: their upkeep is the crown's, every day)
    const realm = Throne.ruledKingdom(player, world);
    if (Utils.random() < 0.1 && realm && (realm.treasury || 0) > Throne.levyQuote(player, world, realm).reserve * 2) {
        const open = Object.keys(Kingship.edicts()).filter(id => Kingship.canPass(player, world, id).ok);
        if (open.length && Kingship.passEdict(player, world, Utils.randPick(open)).success) count(stats, 'edictsPassed');
    }
    for (const f of Kingship.factions(player, world, { revealedOnly: true })) {
        if (!f.faction.ultimatum) continue;
        const res = Utils.random() < 0.5 ? Kingship.arrestLeader(player, world, f.faction.id) : { success: false };
        if (res.success) count(stats, 'factionLeadersArrested');
        else if (Kingship.concede(player, world, f.faction.id).success) count(stats, 'factionsConceded');
    }
    if (court.revolt && Utils.random() < 0.05 && Kingship.parley(player, world).success) count(stats, 'revoltParleys');
    if (Utils.random() < 0.03 && Kingship.holdFeast(player, world).success) count(stats, 'royalFeasts');
    const unhappy = court.vassals.find(v => !v.rebel && v.opinion < -20);
    if (unhappy && Utils.random() < 0.05 && Kingship.grantGold(player, world, unhappy.id).success) count(stats, 'vassalGrants');
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

/** The Bourse: a few shares in the best-yielding houses and banks once rich; sell when short. No dice. */
function bourse(game, tile, stats) {
    const { player, world } = game;
    if (!Bourse.exchangeAt(player, world)) return;
    const held = Bourse.portfolio(player);
    if (player.gold < 1500 && held.length) {
        const p = held[0];
        if (Bourse.sell(player, world, p.listing.id, p.shares).success) count(stats, 'sharesSoldBourse');
        return;
    }
    if (player.gold < 6000 || Bourse.portfolioValue(player) > 4000) return;
    const pick = Bourse.listed(player).filter(l => (l.kind === 'house' || l.kind === 'bank') && l.price > 0)
        .sort((a, b) => b.lastDiv / b.price - a.lastDiv / a.price || a.id.localeCompare(b.id))[0];
    if (pick && Bourse.buy(player, world, pick.id, Math.max(1, Math.min(10, Math.floor(1500 / pick.price)))).success) count(stats, 'sharesBoughtBourse');
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
    // Works: a bakehouse or brewhouse in a town of 3,000+, while there's money to spare
    if (player.gold > 2200 && (s.population || 0) >= 2000) {
        for (const id of ['bakery', 'brewery', 'charcoal', 'mill']) {
            const q = MerchantPrince.investQuote(player, world, tile, id);
            if (!q.lvl || q.lvl > 1 || !(q.margin && q.margin.perRun > 0) || player.gold < q.gold + 1800) continue;
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
        if (onlyGoods && player.gold > q.fee + 4000) buyMaterials(game, tile, q.goods, stats);
        if (Guilds.advanceQuote(player, world, tile, gid).ok && player.gold > q.fee + 3000 && Guilds.advance(player, world, tile, gid).success) count(stats, 'guildRankUp');
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
 * Mining leases (systems/concessions.js): now and then, once settled and with
 * money to spare, bid the least bid on an open auction of a realm's deposit
 * near here when the lease looks like it repays its fee well inside the
 * term. Picks by a hash of the day and the town, not the RNG, so the rest of
 * the run's dice stay where they were.
 */
function concessions(game, tile, stats) {
    const { player, world } = game;
    const s = tile.settlement;
    if (world.day < 120 || player.gold < 3500 || s.kingdom == null) return;
    if (((world.day * 7 + tile.q * 13 + tile.r * 17) % 5) !== 0) return;
    const held = Concessions.mine(player, world).length;
    if (held >= 2) return;
    for (const { a, site } of Concessions.auctionsNear(world, tile.q, tile.r, 8)) {
        if (a.kingdomId !== s.kingdom) continue;
        const q = Concessions.leaseQuote(player, world, site.id);
        if (!q.ok || !q.est || !(q.est.net > 0)) continue;
        // (the houses bid up to about a fifth of the term's net at the close: match the top of that)
        const worth = q.est.net * q.est.term * q.est.cap;
        const fee = Math.max(q.minBid, Math.round(worth * 0.22));
        if (a.bid > 0 || worth < fee * 2.5 || player.gold < fee + 3000) continue;
        if (Concessions.bid(player, world, a.id, fee).success) { count(stats, 'leaseBids'); break; }
    }
    // Leases won: count each once
    for (const m of Concessions.mine(player, world)) {
        if (!m.c.botSeen) { m.c.botSeen = true; count(stats, 'leasesHeld'); }
    }
}

/**
 * Public works (systems/publicWorks.js): once settled and with money to
 * spare, fund one work at a time near here — a toll highway on a busy road
 * whose Steward's estimate repays inside 200 days, or failing that repairs on
 * a worn road of the realm (no toll: a gift to the town) — and top up a work
 * stalled for funds. Picks by a hash of the day and the town (no RNG).
 */
function publicWorks(game, tile, stats) {
    const { player, world } = game;
    if (world.day < 150 || player.gold < 4000) return;
    const mine = PublicWorks.playerWorks(world).filter(w => w.status === 'building' || w.status === 'stalled');
    for (const w of mine) {
        if (w.stall === 'funds' && player.gold > 5000 && PublicWorks.fund(world, player, w.id).success) count(stats, 'publicWorksTopped');
    }
    if (mine.length || ((world.day * 5 + tile.q * 3 + tile.r * 11) % 7) !== 0) return;
    const near = Transport.segmentsNear(world, tile.q, tile.r, 6);
    let pick = null;
    for (const seg of near) {
        const est = PublicWorks.tollEstimate(world, player, 'upgrade_highway', seg.key);
        if (est && est.payback && est.payback <= 200 && est.cost < player.gold - 3000 && (!pick || est.payback < pick.est.payback)) pick = { kind: 'upgrade_highway', seg, est, toll: true };
    }
    if (!pick) {
        for (const seg of near) {
            const q = PublicWorks.quote(world, 'repair', seg.key);
            if (q.ok && q.cost < player.gold - 3000 && Transport.band(Transport.segState(world, seg)) !== 'good') { pick = { kind: 'repair', seg, toll: false }; break; }
        }
    }
    if (pick && PublicWorks.commission(world, player, pick.kind, pick.seg.key, { by: 'player', toll: pick.toll }).success) count(stats, 'publicWorksFunded');
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
 * day 150, with gold to spare, the cheapest estate here or for sale nearby is
 * bought (one; keeping 5,000g in hand for the rest of the trade), its rent taken in kind when the tenants grow sullen
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
    if (world.day >= 150 && mine.length < 1 && ((world.day * 5 + tile.q * 3 + tile.r) % 4) === 0) {
        const ids = [...Estates.estatesOf(world, s.q, s.r).map(e => e.id), ...LandMarket.listingsNear(world, s.q, s.r, 12).map(x => x.e.id)];
        const quotes = ids.map(id => LandMarket.buyQuote(player, world, id)).filter(q => q.ok && q.cost <= player.gold - 5000).sort((a, b) => a.cost - b.cost);
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
        if (!Delves.isDelveSite(tile) || player.health < 50) return;
        if (!Delves.start(player, world, tile).success) return;
        count(stats, 'delvesStarted');
        game.delved = true;
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

function foundColony(game, stats) {
    const { player, world } = game;
    if ((player.colonies || []).length || player.gold < Colonization.COLONY_COST + 1500) return false;
    for (const h of Hex.hexesInRange(player.q, player.r, 3)) {
        const q = Hex.wrapQ(h.q, world.width);
        if (h.r < 0 || h.r >= world.height) continue;
        const t = world.getTile(q, h.r);
        if (!t || !Colonization.canPlayerFoundColony(player, t, world, q, h.r).can) continue;
        if (!travelTo(game, q, h.r)) continue;
        const res = Colonization.foundPlayerColony(player, t, world, q, h.r, null, 'coexistence');
        if (res.success) { count(stats, 'coloniesFounded'); return true; }
    }
    return false;
}

function chooseDestination(game) {
    const { player, world } = game;
    const roll = Utils.random();
    if (roll < 0.2 || (!game.delved && (MerchantHouses.company(player) || world.day >= 45))) {
        // The nearest delve site the bot hasn't failed to reach. Until it has
        // delved once it looks every time (after its company is founded, or
        // day 45): sites are few, a handful a map, and others explore them,
        // so a chance look can miss them all game
        const bad = game.unreachableSites || (game.unreachableSites = new Set());
        let best = null;
        for (const h of Hex.hexesInRange(player.q, player.r, 24)) {
            if (h.r < 0 || h.r >= world.height) continue;
            const q = Hex.wrapQ(h.q, world.width);
            const t = world.getTile(q, h.r);
            if (!t || !t.terrain.passable || !Delves.isDelveSite(t) || bad.has(`${q},${h.r}`)) continue;
            const d = Hex.distance(player.q, player.r, h.q, h.r);
            if (!best || d < best.d) best = { q, r: h.r, d };
        }
        if (best) return { q: best.q, r: best.r, delve: true };
    }
    // Carrying bullion: on to the nearest realm's capital, where its mint buys it (systems/mints.js)
    if (BULLION.some(id => (player.inventory[id] || 0) > 0)) {
        const mint = nearest(world, player, settlementTiles(world), 60).find(t => Mints.mintAt(world, world.getTile(t.q, t.r)));
        if (mint) return { q: mint.q, r: mint.r };
    }
    // Colonies hold court; drop by now and then
    if (roll < 0.3 && (player.colonies || []).length) return { q: player.colonies[0].q, r: player.colonies[0].r };
    // A boss looks in on the gang now and then (systems/gangs.js)
    if (roll >= 0.5 && roll < 0.7) {
        const home = Gangs.bossTowns(player, world).find(b => b.q !== player.q || b.r !== player.r);
        if (home) return { q: home.q, r: home.r };
    }
    // A ship laid up in another port: go back to it now and then, to sail
    if (roll >= 0.3 && roll < 0.4) {
        const laid = (player.ships || []).find(sh => sh.status === 'docked' && (sh.q !== player.q || sh.r !== player.r));
        if (laid) return { q: laid.q, r: laid.r };
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
    const near = nearest(world, player, settlementTiles(world), 6);
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
    player.gold -= 100;
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

/** One day of the bot's play (before the harness ends the day). */
/**
 * The House's unfinished business (systems/houseQuests.js): a matter is settled
 * on reaching its town (the kindest way the purse allows), and once a week the
 * bot rides to the nearest one within a dozen hexes when it can pay.
 */
function houseBusiness(game, stats) {
    const { player, world } = game;
    const open = HouseQuests.open(player);
    if (!open.length) return;
    const order = ['pay', 'deliver', 'coin', 'plead', 'buy', 'ask', 'search'];
    for (const q of [...open]) {
        if (!HouseQuests.at(player, q)) continue;
        const opts = HouseQuests.options(world, player, q.id).filter(o => o.ok);
        const pick = order.map(id => opts.find(o => o.id === id)).find(Boolean);
        if (!pick) continue;
        const r = HouseQuests.act(world, player, q.id, pick.id);
        if (r.success) count(stats, 'houseQuestsSettled');
    }
    if (world.day % 7 !== 3) return;
    const near = HouseQuests.open(player)
        .filter(q => q.target && (q.price == null || player.gold > q.price * 2) && Hex.distance(player.q, player.r, q.target.q, q.target.r) <= 12)
        .sort((a, b) => Hex.distance(player.q, player.r, a.target.q, a.target.r) - Hex.distance(player.q, player.r, b.target.q, b.target.r))[0];
    if (near && travelTo(game, near.target.q, near.target.r)) count(stats, 'houseQuestTrips');
}

export function botDay(game, stats) {
    const { player, world } = game;
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
    if (player.indenturedServitude) {
        if (player.indenturedServitude.canBuyFreedom && player.gold >= player.indenturedServitude.freedomCost) {
            PlayerMilitary.buyFreedom(player);
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
    if (world.day > 150 && !player.boardedShip && !Ships.getVoyage(player)) houseBusiness(game, stats);
    if (Ships.getVoyage(player)) {
        voyageDay(game, stats);
        return;
    }
    if (player.boardedShip) {
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
    if (frugal(game) && (player.army || []).length && !Sieges.active(player)) {
        player.army.splice(0);
        count(stats, 'disbandedToSave');
    }
    // Broke: pay off soldiers and sailors rather than starve
    if (player.gold < 150 && (player.army || []).length > 2) {
        player.army.splice(0, Math.ceil(player.army.length / 2));
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
        if (docked && Ships.sellShip(player, docked.id).success) count(stats, 'shipsSold');
    }
    // Running out of food with money in the purse: make for the nearest town and buy some
    // (one that had food the last time it was tried: a dawn village picked bare is no use)
    const foodless = game.foodlessAt || (game.foodlessAt = {});
    const stocked = (t) => !(world.day - (foodless[`${t.q},${t.r}`] ?? -1e9) < 20);
    let cantBuy = false;
    if (player.getFoodCount() <= 2 && player.gold >= 50 && !player.boardedShip) {
        const at = world.getTile(player.q, player.r);
        if (at && at.settlement) {
            booked(game, 'buyFood', () => buyFood(game, at, stats));
            if (player.getFoodCount() <= 2) { foodless[`${player.q},${player.r}`] = world.day; cantBuy = true; }
        } else {
            const town = nearest(world, player, settlementTiles(world).filter(stocked), 1)[0];
            if (!town) cantBuy = true;
            if (town) {
                game.dest = { q: town.q, r: town.r };
                const from = `${player.q},${player.r}`;
                travelTo(game, town.q, town.r);
                // No road to any town (an island landing): row back out to the anchored ship
                const anchored = (player.ships || []).find(s => s.status === 'anchored' && Hex.distance(s.q, s.r, player.q, player.r) <= 1);
                if (from === `${player.q},${player.r}` && anchored && Ships.rowToShip(player, anchored.id).success) count(stats, 'rowedToShip');
                const now = world.getTile(player.q, player.r);
                if (now && now.settlement) booked(game, 'buyFood', () => buyFood(game, now, stats));
                count(stats, 'foodRuns');
                // No way there: that town is no help today — off to find food in the wild
                if (from === `${player.q},${player.r}` && !player.boardedShip) {
                    foodless[`${town.q},${town.r}`] = world.day;
                    game.dest = null;
                    cantBuy = true;
                } else {
                    return;
                }
            }
        }
    }
    // Low on food and none to be had for money (broke, or nothing on the stalls
    // — a dawn village sells little): live off the land like anyone would —
    // step out of town onto forageable ground and forage or hunt the day there
    const forage = DataLoader.earlyJobs && DataLoader.earlyJobs.foraging;
    const lowFood = player.gold < 20 ? player.getFoodCount() === 0 : player.getFoodCount() <= 2 && cantBuy;
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
    }
    if (player.needs && player.needs.hunger < 60 && player.getFoodCount() > 0) player.eatMeal();
    booked(game, 'courtship', () => courtship(game, stats));
    if ((player.children || []).length) family(game, stats);
    booked(game, 'cadets', () => cadets(game, stats));
    booked(game, 'rivalAgents', () => rivalAgents(game, stats));
    booked(game, 'rivalHouses', () => rivalHouses(game, stats));
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
        const town = nearest(world, player, settlementTiles(world), 3)[0];
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
        const town = nearest(world, player, settlementTiles(world), 3)[0];
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
    // Poor: earn a living before anything grand — a day's labour and the
    // market in town, as a player starting with a light purse would
    if (player.gold < poorBelow(game) && !(player.army || []).length) {
        const here = world.getTile(player.q, player.r);
        // A town whose employers could not pay the day's wages lately is no place
        // to earn bread (three lives starved labouring for nothing in one): move on
        const broke = (t) => world.day - ((game.brokeTowns || {})[`${t.q},${t.r}`] ?? -1e9) < 30;
        if (here && here.settlement && broke(here)) {
            const next = nearest(world, player, settlementTiles(world), 6).find(t => !broke(t));
            if (next) {
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
        const town = nearest(world, player, settlementTiles(world), 6).find(t => !broke(t)) || nearest(world, player, settlementTiles(world), 1)[0];
        if (town) {
            game.dest = { q: town.q, r: town.r };
            travelTo(game, town.q, town.r);
            return;
        }
    }
    if (booked(game, 'holdingSieges', () => defendHoldings(game, stats))) return;
    if (booked(game, 'siege', () => siege(game, stats))) return;
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
    if (!game.dest || (game.dest.q === player.q && game.dest.r === player.r) || (Utils.random() < 0.05 && !game.dest.delve && !game.dest.company)) {
        game.dest = chooseDestination(game);
    }
    if (game.dest) {
        const from = `${player.q},${player.r}`;
        travelTo(game, game.dest.q, game.dest.r);
        // No way there (another island, or beyond the pathfinder's reach): pick again
        if (`${player.q},${player.r}` === from) {
            if (game.dest.delve || game.dest.company) (game.unreachableSites || (game.unreachableSites = new Set())).add(`${game.dest.q},${game.dest.r}`);
            game.dest = null;
            count(stats, 'unreachable');
        }
        count(stats, 'travelDays');
        settlementBusiness(game, stats);
        booked(game, 'delve', () => delve(game, stats));
    }
}
