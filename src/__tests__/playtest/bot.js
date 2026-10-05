// ============================================
// PLAYTEST BOT — a scripted player for the headless soak test
// ============================================
// Each day the bot looks at what PlayerActions offers on its tile and does a
// handful of things a real player would: eats, trades, recruits, fights,
// founds a colony, joins the Thieves' Guild, delves, rules on petitions, hires
// companions, buys and crews a ship and sails it, and presses a claim. Where
// an action is only reachable through a UI dialog it calls the system API the
// dialog calls. All choices draw from the seeded Utils RNG, so a run is
// reproducible from its seed.

import { Utils } from '../../core/utils.js';
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
import { Espionage } from '../../systems/espionage.js';
import { Underworld } from '../../systems/underworld.js';
import { Companions } from '../../systems/companions.js';
import { Upbringing } from '../../systems/upbringing.js';
import { travelTo } from './harness.js';

const FOOD = ['grain', 'bread'];

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
        const qty = Math.min(30, g.quantity, Math.floor(player.gold / Math.max(1, g.price)));
        if (qty <= 0) continue;
        const res = Trading.buyGoods(player, g, qty, tile.settlement);
        if (res.success) { count(stats, 'foodBought', qty); return; }
    }
}

function sellGoods(game, tile, stats) {
    const { player, world } = game;
    for (const [id, qty] of Object.entries({ ...player.inventory })) {
        if (FOOD.includes(id) || !(qty > 0) || id === 'gold') continue;
        if (Treasures.info(id) && Utils.random() < 0.5) continue;
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

function speculate(game, tile, stats) {
    const { player, world } = game;
    if (player.gold < 4000 || Utils.random() > 0.25) return;
    const goods = Trading.getAvailableGoods(tile.settlement, tile, world)
        .filter(g => !FOOD.includes(g.id) && g.quantity > 0 && g.price > 0);
    if (!goods.length) return;
    const g = Utils.randPick(goods);
    const qty = Math.min(g.quantity, 5, Math.floor((player.gold * 0.05) / g.price));
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
        const def = Petitions.getDef(pet.defId);
        const choices = ((def && def.choices) || []).filter(c => Petitions.canChoose(player, pet, c).ok);
        if (!choices.length) continue;
        const res = Petitions.rule(player, world, pet.id, Utils.randPick(choices).id);
        if (res.success) count(stats, 'petitionsRuled');
    }
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
            if (Ships.buyTradeGood(player, world, ship.id, e.id, 10).success) count(stats, 'portBuys');
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
    const res = Ships[act](player, ship.id, world);
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
    const d = Utils.randPick(dest);
    const dTile = world.getTile(d.q, d.r);
    const res = Ships.sailPlayerTo(player, ship.id, d.q, d.r, dTile.settlement.name, world);
    if (res.success) { count(stats, 'voyages'); return true; }
    return false;
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

function treasures(game, stats) {
    const { player, world } = game;
    for (const t of Treasures.held(player)) {
        const id = t.id;
        const tr = t.info;
        if (tr.consume && player.health < 60 && Treasures.use(player, id).success) count(stats, 'treasureUsed');
        else if (tr.prestige && Utils.random() < 0.2 && Treasures.dedicate(player, id, world.day).success) count(stats, 'treasureDedicated');
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
        for (const h of Hex.hexesInRange(player.q, player.r, 8)) {
            if (h.r < 0 || h.r >= world.height) continue;
            const q = Hex.wrapQ(h.q, world.width);
            const t = world.getTile(q, h.r);
            if (t && t.terrain.passable && Delves.isDelveSite(t)) sites.push({ q, r: h.r });
        }
        if (sites.length) return Utils.randPick(sites);
    }
    // Colonies hold court; drop by now and then
    if (roll < 0.3 && (player.colonies || []).length) return { q: player.colonies[0].q, r: player.colonies[0].r };
    const near = nearest(world, player, settlementTiles(world), 6);
    return near.length ? Utils.randPick(near) : null;
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
    if (player.boardedShip) {
        const t = world.getTile(player.q, player.r);
        if (t && t.terrain.passable) Ships.disembark(player, world);
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
    }
    // Broke and foodless: live off the land like anyone would — step out of
    // town onto forageable ground and spend the day searching it
    const forage = DataLoader.earlyJobs && DataLoader.earlyJobs.foraging;
    if (player.gold < 20 && player.getFoodCount() === 0 && forage) {
        let here = world.getTile(player.q, player.r);
        if (!Foraging.lootTableFor(here, forage) || here.settlement) {
            const spot = Hex.neighbors(player.q, player.r)
                .map(n => world.getTile(Hex.wrapQ(n.q, world.width), n.r))
                .find(t => t && !t.settlement && t.terrain.passable && Foraging.lootTableFor(t, forage));
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
    booked(game, 'court', () => court(game, stats));
    booked(game, 'throne', () => throne(game, stats));
    booked(game, 'treasures', () => treasures(game, stats));
    settlementBusiness(game, stats);
    booked(game, 'delve', () => delve(game, stats));
    booked(game, 'fight', () => fight(game, stats));

    const tile = world.getTile(player.q, player.r);
    if (tile && tile.settlement && booked(game, 'sail', () => sail(game, tile, stats))) {
        settlementBusiness(game, stats);
        return;
    }
    if (booked(game, 'colony', () => foundColony(game, stats))) return;

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
