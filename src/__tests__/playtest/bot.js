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
import { Foraging } from '../../player/foraging.js';
import { DataLoader } from '../../core/dataLoader.js';
import { Relationships } from '../../systems/relationships.js';
import { Ships } from '../../systems/ships.js';
import { Petitions } from '../../systems/petitions.js';
import { Delves } from '../../systems/delves.js';
import { Throne } from '../../systems/throne.js';
import { Kingship } from '../../systems/kingship.js';
import { Espionage } from '../../systems/espionage.js';
import { Underworld } from '../../systems/underworld.js';
import { Companions } from '../../systems/companions.js';
import { Upbringing } from '../../systems/upbringing.js';
import { Ailments } from '../../systems/ailments.js';
import { Sieges } from '../../systems/sieges.js';
import { HoldingSieges } from '../../systems/holdingSieges.js';
import { Discovery } from '../../systems/discovery.js';
import { MerchantHouses } from '../../systems/merchantHouses.js';
import { Quests } from '../../systems/quests.js';
import { Patronage } from '../../systems/patronage.js';
import { OutlawLairs } from '../../systems/outlawLairs.js';
import { Finance } from '../../systems/finance.js';
import { MerchantPrince } from '../../systems/merchantPrince.js';
import { Guilds } from '../../systems/guilds.js';
import { MerchantCaravans } from '../../systems/merchantCaravans.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { SettlementMarket } from '../../world/settlementMarket.js';
import { Seasons } from '../../world/seasons.js';
import { travelTo } from './harness.js';

const FOOD = ['grain', 'bread'];
// Bought only when there's no grain or bread for sale
const FOOD_FALLBACK = ['fish'];

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
        const qty = Trading.affordable(player, g, tile.settlement, 30);
        if (qty <= 0) continue;
        const res = Trading.buyGoods(player, g, qty, tile.settlement);
        if (res.success) { count(stats, 'foodBought', qty); return; }
    }
    // No grain or bread to be had (a dearth, a guild's bread monopoly): anything edible
    if (player.getFoodCount() > 2) return;
    for (const id of FOOD_FALLBACK) {
        const g = goods.find(x => x.id === id);
        if (!g || g.quantity <= 0) continue;
        const qty = Trading.affordable(player, g, tile.settlement, 20);
        if (qty <= 0) continue;
        const res = Trading.buyGoods(player, g, qty, tile.settlement);
        if (res.success) { count(stats, 'foodBought', qty); return; }
    }
}

function sellGoods(game, tile, stats) {
    const { player, world } = game;
    const held = PriceKnowledge.state(player).pnl.held;
    const crowded = PlayerInventory.getUsedSlots(player) > PlayerInventory.getCapacity(player) * 0.75;
    for (const [id, qty] of Object.entries({ ...player.inventory })) {
        if (FOOD.includes(id) || !(qty > 0) || id === 'gold') continue;
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
        if (player.gold < 3500 || Utils.random() > 0.3) return;
        if (world.day < 40 && player.gold < 9000) return;
        if (!MerchantHouses.hasCharter(player) && !MerchantHouses.officeCharter(player)) {
            if (MerchantHouses.buyCharter(player, world, tile).success) count(stats, 'chartersBought');
        }
        const capital = Math.min(4000, Math.floor(player.gold * 0.5));
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
        // A standing order on something this market sells: buy at today's
        // price or better, sell a quarter dearer
        if (!post.orders.length) {
            const goods = Trading.getAvailableGoods(tile.settlement, tile, world).filter(g => g.quantity > 5 && g.price > 2);
            if (goods.length) {
                const g = Utils.randPick(goods);
                // Buy on a dip, sell when the price has risen with the season
                const unit = MerchantHouses.factorBuyUnit(player, world, tile, g.id);
                const sale = MerchantHouses.factorSaleUnit(player, world, tile, g.id);
                if (unit && sale && MerchantHouses.setOrder(player, post.id, { good: g.id, buyBelow: Math.floor(unit * 0.95), buyQty: 20, sellAbove: Math.ceil(sale * 1.15), sellQty: 20, keep: 0 }).success) {
                    count(stats, 'ordersSet');
                }
            }
        }
        if (Utils.random() < 0.1) {
            const id = Utils.randPick(Object.keys(player.inventory || {}));
            if (id && MerchantHouses.depositStock(player, world, post.id, id, 5).success) {
                count(stats, 'stockDeposited');
                // ...and let the factor sell it off
                if (!post.orders.some(o => o.good === id) && post.orders.length < 4) MerchantHouses.setOrder(player, post.id, { good: id, buyBelow: 0, buyQty: 0, sellAbove: 1, sellQty: 10, keep: 0 });
            }
        }
        if (Utils.random() < 0.05 && c.capital > 2000) {
            const order = post.orders[0];
            if (order && MerchantHouses.lobbyMonopoly(player, world, post.id, order.good).success) count(stats, 'lobbied');
        }
    }
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
                MerchantHouses.setOrder(player, p.id, { good: ct.good, buyBelow: unit + 2, buyQty: need, sellAbove: 9999, sellQty: 0, keep: 0 });
                break;
            }
        }
    }
    // Stock bought for a contract that's gone: let the factor sell it
    for (const p of c.posts) {
        for (const o of p.orders) {
            if (o.sellQty === 0 && !c.contracts.some(ct => ct.good === o.good)) Object.assign(o, { buyQty: 0, sellQty: 20, sellAbove: 1 });
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
    const act = Utils.random() < 0.1 ? 'commitPiracy' : Utils.randPick(['exploreOcean', 'huntPirates']);
    // Exploring can turn up an uncharted place (systems/discovery.js), as in the ship menu
    const res = act === 'exploreOcean' ? Discovery.exploreOcean(player, ship.id, world) : Ships[act](player, ship.id, world);
    if (res && res.discovery) count(stats, 'discoveredExploring');
    if (res && res.success) count(stats, `sea_${act}`);
    travelTo(game, tile.q, tile.r);
    if (Ships.disembark(player, world).success) count(stats, 'disembarked');
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
        // Rule: try a policy now and then
        const axes = Throne.POLICY_AXES || [];
        if (axes.length && Utils.random() < 0.05) {
            const axis = Utils.randPick(axes);
            const opts = Object.keys((Throne.policies()[axis] || {}).options || {});
            if (opts.length && Throne.setPolicy(player, world, axis, Utils.randPick(opts)).success) count(stats, 'policiesSet');
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
    if (Utils.random() < 0.1) {
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
    if (player.gold > 9000 && Finance.deposit(player, world, bank.id, 2000).success) count(stats, 'deposits');
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

function settlementBusiness(game, stats) {
    const { player, world } = game;
    const tile = world.getTile(player.q, player.r);
    if (!tile || !tile.settlement) return;
    // Use the contextual list the action menu shows, as a sanity check that it builds
    PlayerActions.getAvailableActions(player, tile, world);
    booked(game, 'buyFood', () => buyFood(game, tile, stats));
    booked(game, 'sellGoods', () => sellGoods(game, tile, stats));
    booked(game, 'speculate', () => speculate(game, tile, stats));
    booked(game, 'recruit', () => recruit(game, tile, stats));
    booked(game, 'underworld', () => underworld(game, tile, stats));
    booked(game, 'companions', () => companions(game, tile, stats));
    booked(game, 'work', () => work(game, tile, stats));
    booked(game, 'properties', () => properties(game, tile, stats));
    booked(game, 'ships', () => ships(game, tile, stats));
    booked(game, 'sea', () => seaActivity(game, tile, stats));
    booked(game, 'heist', () => heist(game, tile, stats));
    booked(game, 'company', () => company(game, tile, stats));
    booked(game, 'patronage', () => patronage(game, tile, stats));
    booked(game, 'banking', () => banking(game, tile, stats));
    booked(game, 'merchantPrince', () => merchantPrince(game, tile, stats));
    booked(game, 'guilds', () => guilds(game, tile, stats));
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
    if (roll < 0.2) {
        // A delve site nearby
        const sites = [];
        for (const h of Hex.hexesInRange(player.q, player.r, 12)) {
            if (h.r < 0 || h.r >= world.height) continue;
            const q = Hex.wrapQ(h.q, world.width);
            const t = world.getTile(q, h.r);
            if (t && t.terrain.passable && Delves.isDelveSite(t)) sites.push({ q, r: h.r });
        }
        if (sites.length) return Utils.randPick(sites);
    }
    // Colonies hold court; drop by now and then
    if (roll < 0.3 && (player.colonies || []).length) return { q: player.colonies[0].q, r: player.colonies[0].r };
    // A ship laid up in another port: go back to it now and then, to sail
    if (roll >= 0.3 && roll < 0.4) {
        const laid = (player.ships || []).find(sh => sh.status === 'docked' && (sh.q !== player.q || sh.r !== player.r));
        if (laid) return { q: laid.q, r: laid.r };
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
        if (up.comeOfAge) return;
        if (!up.focus && focuses.length && Upbringing.setFocus(player, child.id, focuses[i % focuses.length], world).success) count(stats, 'focusesSet');
        if (!up.tutor && player.gold > 2500 && Upbringing.hireCourtTutor(player, world, child.id, 'hedge_tutor').success) count(stats, 'tutorsHired');
        const ev = Upbringing.pendingEvent(player, child);
        if (ev) {
            const pick = ev.choices.find(c => c.affordable && !c.risky) || ev.choices.find(c => c.affordable);
            if (pick && Upbringing.resolveEvent(player, world, child.id, pick.id).success) count(stats, 'childEvents');
        }
    });
}

/** One day of the bot's play (before the harness ends the day). */
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
        if (player.jailState.bailCost && player.gold > player.jailState.bailCost * 3) {
            player.gold -= player.jailState.bailCost;
            player.jailState = null;
            player.stamina = player.maxStamina;
            player.movementRemaining = player.maxStamina;
            count(stats, 'bailed');
        } else {
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
    // The quest board: once settled in (past the short soak's horizon, whose
    // runs stay as they were), take the first offer each week while there's room
    if (world.day > 150 && world.day % 7 === 0 && player.quests && player.quests.active.length < 3 && (player.quests.available || []).length) {
        if (Quests.acceptQuest(player, player.quests.available[0].id, world).success) count(stats, 'questsAccepted');
    }
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
    if (player.getFoodCount() <= 2 && player.gold >= 50 && !player.boardedShip) {
        const at = world.getTile(player.q, player.r);
        if (at && at.settlement) {
            booked(game, 'buyFood', () => buyFood(game, at, stats));
        } else {
            const town = nearest(world, player, settlementTiles(world), 1)[0];
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
                // Stuck with no way to a town (cut off, no ship): live off the land below
                game.stranded = from === `${player.q},${player.r}` && player.getFoodCount() === 0;
                if (!game.stranded) return;
                count(stats, 'stranded');
            }
        }
    }
    // Broke and foodless: live off the land like anyone would — step out of
    // town onto forageable ground and spend the day searching it
    const forage = DataLoader.earlyJobs && DataLoader.earlyJobs.foraging;
    if ((player.gold < 20 || game.stranded) && player.getFoodCount() === 0 && forage) {
        game.stranded = false;
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
            const f = Foraging.quickForage(player, here, forage);
            if (f.success && f.added) count(stats, 'foraged');
            return;
        }
    }
    if (player.needs && player.needs.hunger < 60 && player.getFoodCount() > 0) player.eatMeal();
    if ((player.children || []).length) family(game, stats);
    // Badly hurt: get to a town, see a physician and rest there (a pauper
    // can't pay one; better to go and live off the land)
    if (player.health < 50 && player.gold >= 20) {
        const here = world.getTile(player.q, player.r);
        if (here && here.settlement) {
            booked(game, 'buyFood', () => buyFood(game, here, stats));
            if (player.needs && player.needs.hunger < 60 && player.getFoodCount() > 0) player.eatMeal();
            for (const o of Ailments.treatmentOptions(player, world, here.settlement)) {
                if (o.can && Ailments.treat(player, world, here.settlement, o.key).success) count(stats, 'treated');
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
    // before a fever or the flux reaches its deadly stage
    const sickAt = world.getTile(player.q, player.r);
    if (sickAt && sickAt.settlement) {
        for (const opt of Ailments.treatmentOptions(player, world, sickAt.settlement)) {
            if (opt.kind !== 'disease' || !opt.can || player.gold < Math.max(500, opt.cost * 5)) continue;
            const rec = Ailments.list(player).find(a => a.key === opt.key);
            const def = rec && Ailments.def(rec.id);
            const stage = def && def.stages && def.stages[rec.stage];
            if (!stage || !(stage.deathChance > 0)) continue;
            if (booked(game, 'medicine', () => Ailments.treat(player, world, sickAt.settlement, opt.key)).success) count(stats, 'treated');
        }
    }
    if (booked(game, 'holdingSieges', () => defendHoldings(game, stats))) return;
    if (booked(game, 'siege', () => siege(game, stats))) return;
    booked(game, 'court', () => court(game, stats));
    booked(game, 'throne', () => throne(game, stats));
    booked(game, 'treasures', () => treasures(game, stats));
    settlementBusiness(game, stats);
    booked(game, 'delve', () => delve(game, stats));
    booked(game, 'fight', () => fight(game, stats));
    booked(game, 'outlaws', () => outlaws(game, stats));

    booked(game, 'discoveries', () => discoveries(game, stats));
    const tile = world.getTile(player.q, player.r);
    if (tile && tile.settlement && booked(game, 'expedition', () => expedition(game, tile, stats))) return;
    if (tile && tile.settlement && booked(game, 'sail', () => sail(game, tile, stats))) {
        settlementBusiness(game, stats);
        return;
    }
    if (booked(game, 'colony', () => foundColony(game, stats))) return;
    if (booked(game, 'caravans', () => caravans(game, stats))) return;

    if (!game.dest || (game.dest.q === player.q && game.dest.r === player.r) || Utils.random() < 0.05) {
        game.dest = chooseDestination(game);
    }
    if (game.dest) {
        const from = `${player.q},${player.r}`;
        travelTo(game, game.dest.q, game.dest.r);
        // No way there (another island, or beyond the pathfinder's reach): pick again
        if (`${player.q},${player.r}` === from) {
            game.dest = null;
            count(stats, 'unreachable');
        }
        count(stats, 'travelDays');
        settlementBusiness(game, stats);
        booked(game, 'delve', () => delve(game, stats));
    }
}
