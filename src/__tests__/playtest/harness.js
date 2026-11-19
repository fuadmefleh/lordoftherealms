// ============================================
// PLAYTEST HARNESS — a headless game: world + player + the daily turn
// ============================================
// Mirrors the domain half of the real game so a scripted bot can play it:
//   - newGame()   ≈ ui/game/gameSetup.js _doStartNewGame (minus renderer/UI)
//   - endDay()    ≈ ui/game/endDay.js endDay (minus notifications/audio)
//   - travelTo()  ≈ the frame loop's stepAlongPath + onPlayerArrived
//   - roundTrip() ≈ SaveLoad.saveGame → JSON → editorUI.resumeGame
// Keep the call ORDER in endDay() in step with ui/game/endDay.js — the point
// of the harness is to exercise the same sequence the player gets.

import { DawnBirth } from '../../player/dawnBirth.js';
import { Household } from '../../player/household.js';
import { Parentage } from '../../player/parentage.js';
import { Graveyards } from '../../systems/graveyards.js';
import { NpcTheft } from '../../systems/npcTheft.js';
import { Brawls } from '../../systems/brawls.js';
import { IllnessPlayer } from '../../systems/illnessPlayer.js';
import { Plague } from '../../systems/plague.js';
import { TownCrimes } from '../../systems/townCrimes.js';
import { Literacy } from '../../systems/literacy.js';
import { Vanishings } from '../../systems/vanishings.js';
import { PeopleCrimes } from '../../systems/peopleCrimes.js';
import { NightStreets } from '../../systems/nightStreets.js';
import { Wanted } from '../../systems/wanted.js';
import { ProfaneCrimes } from '../../systems/profaneCrimes.js';
import { KinCrimes } from '../../systems/kinCrimes.js';
import { NpcChatImpact } from '../../systems/npcChatImpact.js';
import { Hearsay } from '../../systems/hearsay.js';
import { Bonds } from '../../systems/bonds.js';
import { CourierRiders } from '../../systems/courierRiders.js';
import { RiverFlotsam } from '../../systems/riverFlotsam.js';
import { RiverDrift } from '../../systems/riverDrift.js';
import { RiverNets } from '../../systems/riverNets.js';
import { RiverLife } from '../../systems/riverLife.js';
import { AnimalCompanions } from '../../systems/animalCompanions.js';
import { BackRooms } from '../../systems/backRooms.js';
import { Atrocities } from '../../systems/atrocities.js';
import { Annals } from '../../systems/annals.js';
import { LawCouncil } from '../../systems/lawCouncil.js';
import { PlayerWorks } from '../../player/playerWorks.js';
import { TradeLines } from '../../player/tradeLines.js';
import { Barter } from '../../world/barter.js';
import { AutoUpkeep } from '../../player/autoUpkeep.js';
import { StandingOrders } from '../../player/standingOrders.js';
import { Languages } from '../../systems/languages.js';
import { Lots } from '../../systems/lots.js';
import { Infrastructure } from '../../systems/infrastructure.js';
import { Townsfolk } from '../../systems/townsfolk.js';
import { TownMemory } from '../../systems/townMemory.js';
import { TownEras } from '../../world/townEras.js';
import { NpcMemory } from '../../systems/npcMemory.js';
import { DataLoader } from '../../core/dataLoader.js';
import { CoinCensus } from '../../systems/coinCensus.js';
import { MoneySupply } from '../../world/moneySupply.js';
import { Utils } from '../../core/utils.js';
import { Hex } from '../../core/hex.js';
import { World } from '../../world/world.js';
import { Terrain } from '../../world/terrain.js';
import { WorldEvents } from '../../world/worldEvents.js';
import { WorldUnit } from '../../world/units.js';
import { Player } from '../../player/player.js';
import { PlayerActions } from '../../player/playerActions.js';
import { PlayerEconomy } from '../../player/playerEconomy.js';
import { PlayerMilitary } from '../../player/playerMilitary.js';
import { PlayerReligion } from '../../player/playerReligion.js';
import { Tavern } from '../../player/tavern.js';
import { SaveLoad } from '../../systems/saveLoad.js';
import { Banking, MarketDynamics, Taxation } from '../../systems/marketDynamics.js';
import { Quests } from '../../systems/quests.js';
import { Achievements } from '../../systems/achievements.js';
import { Technology } from '../../systems/technology.js';
import { Relationships } from '../../systems/relationships.js';
import { Afterlife } from '../../player/afterlife.js';
import { House } from '../../systems/house.js';
import { Schemes } from '../../systems/schemes.js';
import { Demands } from '../../systems/demands.js';
import { Titles } from '../../systems/titles.js';
import { Councils } from '../../systems/councils.js';
import { Housing } from '../../systems/housing.js';
import { Ships } from '../../systems/ships.js';
import { Petitions } from '../../systems/petitions.js';
import { Delves } from '../../systems/delves.js';
import { RealmWars } from '../../systems/realmWars.js';
import { Throne } from '../../systems/throne.js';
import { Kingship } from '../../systems/kingship.js';
import { Espionage } from '../../systems/espionage.js';
import { Gossip } from '../../systems/gossip.js';
import { Traits } from '../../systems/traits.js';
import { Underworld } from '../../systems/underworld.js';
import { LegendaryArtifacts } from '../../systems/legendaryArtifacts.js';
import { Cartography } from '../../systems/cartography.js';
import { Ailments } from '../../systems/ailments.js';
import { Rivals } from '../../systems/rivals.js';
import { Nemesis } from '../../systems/nemesis.js';
import { HouseQuests } from '../../systems/houseQuests.js';
import { Sagas } from '../../systems/sagas.js';
import { Whispers } from '../../systems/whispers.js';
import { Devotion } from '../../systems/devotion.js';
import { SoulPact } from '../../systems/soulPact.js';
import { CourtLetters } from '../../systems/courtLetters.js';
import { Couriers } from '../../systems/couriers.js';
import { Hospitality } from '../../systems/hospitality.js';
import { Crops } from '../../systems/crops.js';
import { Livestock } from '../../systems/livestock.js';
import { Mail } from '../../systems/mail.js';
import { Sieges } from '../../systems/sieges.js';
import { HoldingSieges } from '../../systems/holdingSieges.js';
import { Coalitions } from '../../systems/coalitions.js';
import { RivalAgents } from '../../systems/rivalAgents.js';
import { Discovery } from '../../systems/discovery.js';
import { Holdings } from '../../systems/holdings.js';
import { Stewards } from '../../systems/stewards.js';
import { Upbringing } from '../../systems/upbringing.js';
import { HeirAgency } from '../../systems/heirAgency.js';
import { Raising } from '../../systems/raising.js';
import { HeirPaths } from '../../systems/heirPaths.js';
import { Trials } from '../../player/trials.js';
import { DynastyTree } from '../../systems/dynastyTree.js';
import { Heirlooms } from '../../systems/heirlooms.js';
import { Regency } from '../../systems/regency.js';
import { Abdication } from '../../systems/abdication.js';
import { MerchantHouses } from '../../systems/merchantHouses.js';
import { Heralds } from '../../systems/heralds.js';
import { Patronage } from '../../systems/patronage.js';
import { OutlawLairs } from '../../systems/outlawLairs.js';
import { Gangs } from '../../systems/gangs.js';
import { MerchantCaravans } from '../../systems/merchantCaravans.js';
import { Finance } from '../../systems/finance.js';
import { MarketFairs } from '../../systems/marketFairs.js';
import { MerchantPrince } from '../../systems/merchantPrince.js';
import { Labour } from '../../systems/labour.js';
import { Guilds } from '../../systems/guilds.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { PriceNews } from '../../systems/priceNews.js';
import { Concessions } from '../../systems/concessions.js';
import { LandMarket } from '../../systems/landMarket.js';
import { PuttingOut } from '../../systems/puttingOut.js';
import { Harvests } from '../../world/harvests.js';
import { TradePolicy } from '../../systems/tradePolicy.js';
import { EconomyChronicle } from '../../systems/economyChronicle.js';
import { Ledger } from '../../systems/ledger.js';
import { Underwriting } from '../../systems/underwriting.js';
import { Bills } from '../../systems/bills.js';
import { Bourse } from '../../systems/bourse.js';
import { PublicWorks } from '../../systems/publicWorks.js';
import { GreatWorks } from '../../systems/greatWorks.js';
import { Mints } from '../../systems/mints.js';
import { Fiscal } from '../../systems/fiscal.js';
import { Engrossing } from '../../systems/engrossing.js';
import { resolveHostileEncounter } from '../../ui/game/combat.logic.js';
import { RoadEncounters } from '../../player/roadEncounters.js';
import { Pirates } from '../../systems/pirates.js';
import { Landings } from '../../systems/landings.js';
import { MapTheft } from '../../systems/mapTheft.js';
import { FirstSteps } from '../../systems/firstSteps.js';
import { Reckoning } from '../../systems/reckoning.js';
import { RivalHouses } from '../../systems/rivalHouses.js';
import { CadetBranches } from '../../systems/cadetBranches.js';
import { Commissions } from '../../systems/commissions.js';
import { Victory } from '../../systems/victory.js';
import { Fame } from '../../systems/fame.js';
import { Crises } from '../../systems/crises.js';
import { Climate } from '../../world/climate.js';
import { RealmTimeline } from '../../systems/realmTimeline.js';

export const WORLD_W = 80;
export const WORLD_H = 60;
export const GEN = { kingdomCount: 10 };

export async function loadData() {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
}

/** A fresh game, set up in gameSetup.js's order. */
export function newGame(seed, gen = {}) {
    Utils.setSeed(seed);
    const world = new World(WORLD_W, WORLD_H);
    world.generate({ ...GEN, ...gen });
    const player = new Player({ firstName: 'Bot', lastName: 'Harness', gender: 'male', age: 20 });
    player.placeInWorld(world);

    Quests.initialize(player);
    Quests.grantStarterQuest(player, world);
    Achievements.initialize(player);
    MarketDynamics.initialize();
    Technology.initPlayer(player);
    Relationships.initialize(player);
    DawnBirth.apply(player, world);
    Languages.initialize(player, world);
    House.initialize(player, world);
    House.seedRivals(player, world);
    if (!player.taxRate) player.taxRate = 'moderate';
    Titles.initialize(player);
    Councils.initializePlayer(player);
    FirstSteps.initialize(player, world, { enabled: true });
    // (at the dawn the start purse is goods: world/barter.js, as gameSetup.js)
    Barter.beginPlayer(player, world);
    player.updateVisibility(world, 4);
    return { seed, world, player, log: [] };
}

/** ui/game/combat.js _checkHostileEncounters, minus audio/notifications. */
function checkHostileEncounters(game) {
    const { world, player } = game;
    if (player.indenturedServitude) return null;
    if (PlayerReligion.isInSanctuary(player, player.q, player.r, world.width)) return null;
    if (WorldUnit.isSafeHaven(world, player.q, player.r)) return null;
    const hostiles = world.units.filter(u =>
        !u.destroyed &&
        !u.sparesPlayer &&
        !RoadEncounters.isSparing(u, world.day) && // paid off, talked down, driven off (as combat.js)
        WorldUnit.isHostile(u) &&
        Hex.wrappingDistance(u.q, u.r, player.q, player.r, world.width) <= 1);
    if (hostiles.length === 0) return null;
    const attacker = hostiles.reduce((a, b) => b.strength > a.strength ? b : a, hostiles[0]);
    const before = player.gold;
    const res = resolveHostileEncounter(player, attacker, world);
    // (who fell on the bot, and what it cost: the verbose soak report's `hostiles`)
    const by = game.hostileBy || (game.hostileBy = {});
    const row = by[attacker.type] || (by[attacker.type] = { n: 0, gold: 0 });
    row.n++;
    if (Number.isFinite(player.gold - before)) row.gold = Math.round(row.gold + player.gold - before);
    return res;
}

/** Every settlement's people, summed. */
export function worldPeople(world) {
    let sum = 0;
    for (const row of world.tiles) for (const t of row) if (t.settlement) sum += Number(t.settlement.population) || 0;
    return sum;
}

/** Every town's purse and every living crown's treasury, summed. */
export function worldMoney(world) {
    let sum = 0;
    for (const row of world.tiles) {
        for (const t of row) {
            const e = t.settlement && t.settlement.economy;
            if (e && Number.isFinite(e.gold)) sum += e.gold;
        }
    }
    for (const k of world.kingdoms || []) if (k && k.isAlive && Number.isFinite(k.treasury)) sum += k.treasury;
    return sum;
}

/**
 * Record the player's gold after a step of the daily turn when it changed —
 * game.trace tells an invariant failure which system moved the money.
 */
function mark(game, label) {
    if (game.timing) {
        const now = performance.now();
        game.timing[label] = (game.timing[label] || 0) + (now - (game._lastMark || now));
        game._lastMark = now;
    }
    // game.moneyTrace (SOAK_MONEY=1): the world's coin — town purses and crown
    // treasuries — after each step, booked by the step that moved it
    if (game.moneyTrace) {
        const t = game.moneyTrace;
        // (t.full: every purse in the world — CoinCensus.total — not just towns and crowns)
        const m = t.full ? CoinCensus.total(game.world, game.player).total : worldMoney(game.world);
        if (t.last != null && Number.isFinite(m - t.last)) {
            t.by[label] = (t.by[label] || 0) + (m - t.last);
            t.day[label] = (t.day[label] || 0) + (m - t.last);
        }
        t.last = m;
        // (t.full: ...and the part of it no book explains — MoneySupply.bookedChange — by step: t.unbooked)
        if (t.full) {
            const b = MoneySupply.bookedChange(game.world);
            if (!t.unbooked) t.unbooked = {};
            if (t.lastBooked != null && t.lastM != null) {
                const u = (m - t.lastM) - (b - t.lastBooked);
                if (Math.abs(u) > 1e-6) t.unbooked[label] = (t.unbooked[label] || 0) + u;
            }
            t.lastBooked = b;
            t.lastM = m;
        }
        // ...and the crowns' chests alone (t.crown: what moved the treasuries, by step)
        let c = 0;
        for (const k of game.world.kingdoms || []) if (k && k.isAlive && Number.isFinite(k.treasury)) c += k.treasury;
        if (!t.crown) t.crown = {};
        if (t.crownLast != null) t.crown[label] = (t.crown[label] || 0) + (c - t.crownLast);
        t.crownLast = c;
        // (the crowns' closed day by budget line, summed: t.lines)
        if (label === 'Fiscal.processDay') {
            if (!t.lines) t.lines = {};
            for (const k of game.world.kingdoms || []) {
                const last = k && k.isAlive && k.fisc && k.fisc.last;
                if (last) for (const l in last) if (last[l]) t.lines[l] = (t.lines[l] || 0) + last[l];
            }
        }
        // ...and the world's people the same way (game.popTrace)
        const pt = game.popTrace;
        if (pt) {
            const n = worldPeople(game.world);
            if (pt.last != null) pt.by[label] = (pt.by[label] || 0) + (n - pt.last);
            pt.last = n;
        }
    }
    const g = game.player.gold;
    const last = game.trace.length ? game.trace[game.trace.length - 1][1] : null;
    if (g !== last) {
        game.trace.push([label, g]);
        if (last !== null && Number.isFinite(g - last)) {
            game.ledger = game.ledger || {};
            game.ledger[label] = Math.round((game.ledger[label] || 0) + g - last);
        }
    }
}

/**
 * The daily turn — the domain calls of ui/game/endDay.js endDay(), in order.
 * Returns { died } when the run would hand over to the death screen.
 */
export function endDay(game) {
    // (the settlement scan advanceDay makes is kept for the systems after it, as endDay.js does)
    try {
        return _endDay(game);
    } finally {
        if (typeof game.world.releaseSettlementScan === 'function' && game.world._scanHolds > 0) game.world.releaseSettlementScan();
    }
}

function _endDay(game) {
    const { world, player } = game;
    const out = { died: null };
    game.trace = [];
    mark(game, 'start');

    // The day's last hours (player/autoUpkeep.js). The bot sees to its own needs
    // and spends its points on work, so it's off unless a run asks for it
    // (game.autoUpkeep = 'full' | 'upkeep'); what it did is kept on game.upkeep.
    // A standing order set on the player (player/standingOrders.js) runs after the upkeep,
    // as ui/game/endDay.js does; what it did is kept on game.standingOrder.
    if (StandingOrders.get(player) !== 'rest') {
        const last = StandingOrders.endOfDay(player, world, { upkeepMode: game.autoUpkeep || 'off' });
        game.upkeep = last.upkeep;
        game.standingOrder = last.order;
    } else {
        game.upkeep = game.autoUpkeep ? AutoUpkeep.run(player, world, { mode: game.autoUpkeep }) : null;
    }
    mark(game, 'AutoUpkeep.run');
    game.trialsDay = Trials.processDay(world, player);
    mark(game, 'Trials.processDay');
    PlayerActions.endDay(player, world);
    mark(game, 'PlayerActions.endDay');
    Councils.processDaily(player, world);
    mark(game, 'Councils.processDaily');
    world.holdSettlementScan();
    const result = world.advanceDay(player, {
        playerBonuses: {
            colonyGrowth: Technology.getEffectTotal(player, 'settlementGrowthBonus')
                + Technology.getEffectTotal(player, 'populationGrowthBonus'),
            colonyLoyalty: 0.1 * Technology.getEffectTotal(player, 'stabilityBonus'),
            colonyFood: Technology.getEffectTotal(player, 'settlementFoodBonus'),
        },
    });
    mark(game, 'world.advanceDay');
    Barter.syncPlayer(world, player);
    player.endDay(world);
    mark(game, 'player.endDay');
    const eventEffects = WorldEvents.applyPlayerDailyEffects(world, player) || {};
    mark(game, 'WorldEvents.applyPlayerDailyEffects');
    const ailmentDay = Ailments.processDay(world, player, {
        exposure: eventEffects.weatherHealthLost || 0,
        weather: eventEffects.weather,
    });
    mark(game, 'Ailments.processDay');
    if (ailmentDay && ailmentDay.died) {
        out.died = ailmentDay.died.cause || 'illness';
        return out;
    }
    player.updateVisibility(world, 4);
    mark(game, 'player.updateVisibility');
    Cartography.exposeDeceptions(player, world);
    mark(game, 'Cartography.exposeDeceptions');
    checkHostileEncounters(game);
    mark(game, 'checkHostileEncounters');
    Espionage.applySpyVision(player, world);
    mark(game, 'Espionage.applySpyVision');

    if (player.health <= 0 && player.starvationDays > 0) {
        out.died = 'starvation';
        return out;
    }

    LegendaryArtifacts.processDaily(player);
    mark(game, 'LegendaryArtifacts.processDaily');
    Housing.processDaily(player, world);
    mark(game, 'Housing.processDaily');
    Household.processDay(player, world);
    mark(game, 'Household.processDay');
    const shipDay = Ships.processDaily(player, world);
    mark(game, 'Ships.processDaily');
    game.voyageDay = (shipDay && shipDay.voyage) || null;
    // Standing trade lines (player/tradeLines.js) — as endDay.js
    game.tradeLinesDay = TradeLines.processDay(world, player);
    mark(game, 'TradeLines.processDay');

    // Construction ticks (properties, religious, infrastructure, cultural) — as endDay.js
    PlayerWorks.processDay(player, world);
    mark(game, 'PlayerWorks.processDay');

    Relationships.processDailyEvents(player, world);
    mark(game, 'Relationships.processDailyEvents');
    const aging = Relationships.processAging(player, world);
    mark(game, 'Relationships.processAging');
    if (aging && aging.died) {
        out.died = 'old age';
        return out;
    }
    Upbringing.processDay(player, world);
    mark(game, 'Upbringing.processDay');
    HeirAgency.processDay(player, world);
    mark(game, 'HeirAgency.processDay');
    Raising.processDay(player, world);
    mark(game, 'Raising.processDay');
    HeirPaths.processDay(player, world);
    mark(game, 'HeirPaths.processDay');
    Regency.processDay(player, world);
    mark(game, 'Regency.processDay');
    Abdication.processDay(player, world);
    mark(game, 'Abdication.processDay');
    if (player.house) DynastyTree.sync(player, world, { npc: id => Relationships.getNPC(id) });
    Heirlooms.processDay(player, world);
    mark(game, 'Heirlooms.processDay');
    // Building lots and houses to let; the townsfolk live a season (endDay.js order)
    game.lotsDay = Lots.processDay(world, player);
    mark(game, 'Lots.processDay');
    Graveyards.processDay(world, player);
    mark(game, 'Graveyards.processDay');
    NpcTheft.processDay(world, player, { onMap: false });
    mark(game, 'NpcTheft.processDay');
    Brawls.processDay(world, player, { onMap: false });
    mark(game, 'Brawls.processDay');
    Townsfolk.processDay(world, player);
    mark(game, 'Townsfolk.processDay');
    NpcMemory.processDay(world, player);
    mark(game, 'NpcMemory.processDay');
    // The townsfolk's sicknesses and the plague towns (systems/illnessPlayer.js, systems/plague.js)
    game.sickDay = IllnessPlayer.processDay(world, player, { contact: null });
    mark(game, 'IllnessPlayer.processDay');
    Plague.processDay(world, player);
    mark(game, 'Plague.processDay');
    TownMemory.processDay(world, player);
    mark(game, 'TownMemory.processDay');
    TownCrimes.processDay(world, player);
    mark(game, 'TownCrimes.processDay');
    // (endDay.js: the towns age once a year)
    game.townErasDay = TownEras.processDay(world, player);
    mark(game, 'TownEras.processDay');
    Literacy.processDay(world, player);
    mark(game, 'Literacy.processDay');
    Relationships.syncFolk(player, world);
    mark(game, 'Relationships.syncFolk');
    Vanishings.processDay(world, player);
    mark(game, 'Vanishings.processDay');
    PeopleCrimes.processDay(world, player);
    mark(game, 'PeopleCrimes.processDay');
    NightStreets.processDay(player, world);
    mark(game, 'NightStreets.processDay');
    Relationships.prepareForSave(player);
    mark(game, 'Relationships.prepareForSave');

    House.processDaily(player, world);
    mark(game, 'House.processDaily');
    RivalHouses.processDay(player, world);
    mark(game, 'RivalHouses.processDay');
    CadetBranches.processDay(player, world);
    mark(game, 'CadetBranches.processDay');
    Schemes.processDaily(player, world);
    mark(game, 'Schemes.processDaily');
    Demands.processDay(world, player);
    mark(game, 'Demands.processDay');
    Petitions.processDay(player, world);
    mark(game, 'Petitions.processDay');
    Delves.processDay(world, player);
    mark(game, 'Delves.processDay');
    Rivals.processDay(world, player);
    mark(game, 'Rivals.processDay');
    Nemesis.processDay(world, player);
    mark(game, 'Nemesis.processDay');
    Wanted.processDay(world, player);
    mark(game, 'Wanted.processDay');
    ProfaneCrimes.processDay(world, player);
    KinCrimes.processDay(world, player);
    mark(game, 'KinCrimes.processDay');
    HouseQuests.processDay(world, player);
    mark(game, 'HouseQuests.processDay');
    Sagas.processDay(world, player);
    mark(game, 'Sagas.processDay');
    Whispers.processDay(world, player);
    mark(game, 'Whispers.processDay');
    NpcChatImpact.processDay(world, player);
    mark(game, 'NpcChatImpact.processDay');
    Hearsay.processDay(world, player);
    mark(game, 'Hearsay.processDay');
    Bonds.processDay(world, player);
    mark(game, 'Bonds.processDay');
    Devotion.processDay(world, player);
    SoulPact.processDay(world, player);
    mark(game, 'Devotion.processDay');
    MapTheft.processDay(world, player);
    mark(game, 'MapTheft.processDay');
    CourtLetters.processDay(world, player);
    mark(game, 'CourtLetters.processDay');
    Couriers.processDay(world, player);
    mark(game, 'Couriers.processDay');
    CourierRiders.processDay(world, player);
    mark(game, 'CourierRiders.processDay');
    Mail.processDay(world, player);
    mark(game, 'Mail.processDay');
    Hospitality.processDay(world, player);
    mark(game, 'Hospitality.processDay');
    // A ship at sea overnight goes with the current; the rivers' day (endDay.js order)
    if (player.boardedShip && typeof player.driftWithCurrent === 'function') player.driftWithCurrent(world);
    RiverFlotsam.processDay(world, player, world.day);
    RiverDrift.processDay(world, player, world.day * 24);
    mark(game, 'RiverFlotsam+Drift.processDay');
    RiverNets.processDay(world, player, world.day, {
        goodOf: (id) => { const g = (PlayerEconomy.GOODS || {})[String(id).toUpperCase()]; return { name: (g && g.name) || id, icon: (g && g.icon) || '' }; },
        rollBonus: (net) => RiverLife.netRollBonus(world, net),
    });
    mark(game, 'RiverNets.processDay');
    RiverLife.processDay(world, player, world.day);
    mark(game, 'RiverLife.processDay');
    Livestock.processDay(world, player);
    mark(game, 'Livestock.processDay');
    AnimalCompanions.processDay(world, player, { larder: (key) => { const h = Household.home(player, key); return h ? h.larder : null; } });
    mark(game, 'AnimalCompanions.processDay');
    Crops.processDay(world, player);
    mark(game, 'Crops.processDay');
    game.commissionsDay = Commissions.processDay(player, world);
    mark(game, 'Commissions.processDay');
    game.languagesDay = Languages.processDay(player, world);
    mark(game, 'Languages.processDay');
    game.dawnSettled = DawnBirth.sync(player, world) || null;
    Parentage.processDay(player, world);
    mark(game, 'Parentage.processDay');
    Gangs.processDay(world, player);
    mark(game, 'Gangs.processDay');
    BackRooms.processDay(player, world);
    mark(game, 'BackRooms.processDay');
    OutlawLairs.processDay(world, player);
    mark(game, 'OutlawLairs.processDay');
    game.discoveryDay = Discovery.processDay(world, player);
    mark(game, 'Discovery.processDay');
    // Sea rovers (systems/pirates.js): a threat at sea is fought out with the defaults
    game.pirateDay = Pirates.processDay(world, player);
    if (game.pirateDay.threat) Pirates.autoResolve(player, world, Pirates.startThreat(player, world, game.pirateDay.threat));
    mark(game, 'Pirates.processDay');
    // Sea reavers landing on coastal holdings (systems/landings.js)
    game.landingDay = Landings.processDay(world, player);
    mark(game, 'Landings.processDay');
    RealmWars.processDaily(player, world);
    mark(game, 'RealmWars.processDaily');
    game.holdingSiegeDay = HoldingSieges.processDay(world, player);
    mark(game, 'HoldingSieges.processDay');
    game.coalitionDay = Coalitions.processDay(world, player, { armyStrength: PlayerMilitary.getArmyStrength(player) });
    mark(game, 'Coalitions.processDay');
    RivalAgents.processDay(world, player);
    mark(game, 'RivalAgents.processDay');
    Throne.processDaily(player, world, { armyStrength: PlayerMilitary.getArmyStrength(player) });
    mark(game, 'Throne.processDaily');
    Kingship.processDay(world, player);
    mark(game, 'Kingship.processDay');
    Sieges.processDay(world, player);
    mark(game, 'Sieges.processDay');
    Atrocities.processDay(world, player);
    mark(game, 'Atrocities.processDay');
    game.holdingsDay = Holdings.processDay(player, world);
    mark(game, 'Holdings.processDay');
    game.stewardsDay = Stewards.processDay(world, player);
    mark(game, 'Stewards.processDay');
    MerchantHouses.processDay(player, world);
    mark(game, 'MerchantHouses.processDay');
    game.patronageDay = Patronage.processDay(world, player);
    mark(game, 'Patronage.processDay');
    Heralds.processDay(world, player);
    mark(game, 'Heralds.processDay');
    Annals.processDay(world, player);
    mark(game, 'Annals.processDay');
    game.caravanDay = MerchantCaravans.processDay(world, player);
    mark(game, 'MerchantCaravans.processDay');
    game.fairDay = MarketFairs.processDay(world, player);
    mark(game, 'MarketFairs.processDay');
    game.harvestDay = Harvests.processDay(world, player);
    mark(game, 'Harvests.processDay');
    game.engrossDay = Engrossing.processDay(world, player);
    mark(game, 'Engrossing.processDay');
    LawCouncil.processDay(world, player);
    mark(game, 'LawCouncil.processDay');
    game.hinterlandDay = Concessions.processDay(world, player);
    mark(game, 'Concessions.processDay');
    game.landDay = LandMarket.processDay(world, player);
    mark(game, 'LandMarket.processDay');
    game.puttingOutDay = PuttingOut.processDay(world, player);
    mark(game, 'PuttingOut.processDay');
    game.tradePolicyDay = TradePolicy.processDay(world, player);
    mark(game, 'TradePolicy.processDay');
    game.worksDay = PublicWorks.processDay(world, player);
    mark(game, 'PublicWorks.processDay');
    game.ageWorksDay = GreatWorks.processDay(world, player);
    mark(game, 'GreatWorks.processDay');
    MarketDynamics.updatePrices(world, player);
    mark(game, 'MarketDynamics.updatePrices');
    game.labourDay = Labour.processDay(world, player);
    mark(game, 'Labour.processDay');
    game.princeDay = MerchantPrince.processDay(player, world);
    mark(game, 'MerchantPrince.processDay');
    game.guildDay = Guilds.processDay(world, player);
    mark(game, 'Guilds.processDay');
    PriceKnowledge.processDay(player, world, {
        posts: (MerchantHouses.company(player) || {}).posts || [],
        holdings: Holdings.list(player, world),
        traders: MerchantCaravans.traders(world),
    });
    mark(game, 'PriceKnowledge.processDay');
    game.priceNewsDay = PriceNews.processDay(world, player);
    mark(game, 'PriceNews.processDay');
    game.chronicleDay = EconomyChronicle.processDay(world, player);
    mark(game, 'EconomyChronicle.processDay');
    game.victoryDay = Victory.check(player, world) || null;
    mark(game, 'Victory.check');

    Tavern.expireOldIntel(player, world.day);
    mark(game, 'Tavern.expireOldIntel');
    game.intelDay = Tavern.processInformants(player, world);
    mark(game, 'Tavern.processInformants');
    Espionage.processDaily(player, world);
    mark(game, 'Espionage.processDaily');
    Espionage.prepareForSave(player);
    mark(game, 'Espionage.prepareForSave');
    Gossip.processDaily(player, world);
    mark(game, 'Gossip.processDaily');
    game.fiscalDay = Fiscal.processDay(world, player);
    mark(game, 'Fiscal.processDay');
    game.financeDay = Finance.processDay(world, player);
    mark(game, 'Finance.processDay');
    game.underwritingDay = Underwriting.processDay(world, player);
    mark(game, 'Underwriting.processDay');
    game.billsDay = Bills.processDay(world, player);
    mark(game, 'Bills.processDay');
    game.bourseDay = Bourse.processDay(world, player);
    mark(game, 'Bourse.processDay');
    game.mintsDay = Mints.processDay(world, player);
    mark(game, 'Mints.processDay');
    game.climateDay = Climate.processDay(world, player);
    mark(game, 'Climate.processDay');
    game.crisisDay = Crises.processDay(world, player);
    mark(game, 'Crises.processDay');
    RealmTimeline.processDay(world, player);
    mark(game, 'RealmTimeline.processDay');
    game.taxDay = world.day % 7 === 0 ? Taxation.collectTaxes(player, world) : null;
    mark(game, 'Taxation.collectTaxes');
    if (player.queuedPath) player.resumeQueuedPath();

    PlayerEconomy.spawnTravelingMerchant(player, world);
    mark(game, 'PlayerEconomy.spawnTravelingMerchant');
    if (result && Array.isArray(result.events)) {
        for (const event of result.events) WorldEvents.applyPlayerEffects(event, player, world);
    }
    const completed = Quests.updateProgress(player, world);
    mark(game, 'Quests.updateProgress');
    for (const quest of completed) House.recordPlayerDeed(player, world, 'quest', { reason: `quest: ${quest.title}` });
    Traits.processDay(player, world);
    mark(game, 'Traits.processDay');
    Underworld.processDay(player, world);
    mark(game, 'Underworld.processDay');
    FirstSteps.processDay(world, player);
    mark(game, 'FirstSteps.processDay');
    Achievements.checkAchievements(player, world);
    mark(game, 'Achievements.checkAchievements');
    // The day's books close (endDay.js's finance row, from the turn's results; systems/ledger.js)
    Ledger.closeDay(player, world, Ledger.fromResults(world, player, {
        princeDay: game.princeDay, guildDay: game.guildDay, holdingsDay: game.holdingsDay,
        taxCollected: (game.taxDay && game.taxDay.collected) || 0, intelCost: (game.intelDay && game.intelDay.cost) || 0,
    }));
    // The Season's Reckoning, after the books close (endDay.js; systems/reckoning.js)
    game.reckoningDay = Reckoning.processDay(world, player);
    mark(game, 'Reckoning.processDay');
    // A voyage that made port today lands the player there (endDay.js hands
    // the day's voyage report to ui/actionMenu/voyage.js, which does this)
    if (game.voyageDay && game.voyageDay.arrived) onArrived(game);
    return out;
}

/** onPlayerArrived's domain half. */
export function onArrived(game) {
    const { world, player } = game;
    const tile = world.getTile(player.q, player.r);
    if (!tile || !tile.settlement) return;
    Quests.trackSettlementVisited(player, tile.settlement.name);
    const kId = tile.settlement.kingdom;
    if (kId) {
        if (!player.kingdomsVisited) player.kingdomsVisited = [];
        if (!player.kingdomsVisited.includes(kId)) player.kingdomsVisited.push(kId);
    }
    Underworld.onEnterSettlement(player, world, tile);
    Fame.onEnterSettlement(player, world, tile);
    if (kId) player.learnAboutKingdom(kId, 'basics');
    Rivals.onPlayerArrived(player, world, tile);
    walkIntoTown(world, tile);
}

/**
 * Walking into a town's streets (ui/game/innerMap.js → world/innerMap/npcs.js
 * _settleTownsfolk): the town's living roster is built on the first visit
 * (headless: Townsfolk.seed, the roster the town's size gives, on its own hash
 * stream) and its seasons caught up on every visit after (Townsfolk.attach).
 * Without it no town the bot passes through has named people, so nothing they
 * remember of the House (systems/npcMemory.js) can become a house quest.
 */
export function walkIntoTown(world, tile) {
    const s = tile && tile.settlement;
    if (!s) return null;
    if (!s.folk) Townsfolk.seed(s, world, { q: tile.q, r: tile.r });
    return Townsfolk.attach(s, world, null, { q: tile.q, r: tile.r });
}

/**
 * Walk (or sail, when boarded) toward (q, r) with today's stamina, the way the
 * frame loop does. Returns true when the player stands on the target.
 */
export function travelTo(game, q, r) {
    const { world, player } = game;
    if (player.q === q && player.r === r) return true;
    if (!player.moveTo(q, r, world)) return false;
    let guard = 0;
    while (player.isMoving && guard++ < 500) player.stepAlongPath(world, 1);
    const arrived = player.q === q && player.r === r;
    if (arrived) onArrived(game);
    return arrived;
}

/** Save → JSON → load into a fresh World/Player, as resumeGame does. */
export function roundTrip(game) {
    const { world, player } = game;
    Relationships.prepareForSave(player);
    Espionage.prepareForSave(player);
    const json = JSON.stringify({
        world: SaveLoad.serializeWorld(world),
        player: SaveLoad.serializePlayer(player),
    });
    const data = JSON.parse(json);

    // As editorUI.resumeGame: regenerate from the saved seed, then overlay the save
    const w2 = new World(data.world.width, data.world.height);
    w2.generate(data.world.generationParams || {});
    SaveLoad.restoreWorld(data.world, w2);
    Terrain.identifyRegions(w2.tiles, w2.width, w2.height);
    const p2 = new Player();
    SaveLoad.restorePlayer(data.player, p2, w2);
    p2.updateVisibility(w2, 4);
    MarketDynamics.initialize();
    SaveLoad.restoreMarkets(data.world, w2);
    Relationships.initialize(p2);
    Ships.restoreFromSave(p2);
    Titles.initialize(p2);
    return { ...game, world: w2, player: p2, bytes: json.length };
}

/**
 * The death screen's choice, made for the bot so a run can span generations
 * (ui/actionMenu/social.js showDeathScreen): the designated heir — else the
 * eldest own child of age, else a sibling — takes up the mantle (Relationships.succeedAsHeir); with no
 * heir, a new life as someone else in the world (Afterlife.becomeStranger),
 * which replaces game.player. Returns { how: 'heir'|'cadet'|'stranger'|null, name }.
 */
export function carryOn(game, cause) {
    const { world } = game;
    const old = game.player;
    const heirs = Relationships.getEligibleHeirs(old);
    if (heirs.length) {
        // getEligibleHeirs lists the ruler's own children first, eldest first, then siblings
        const heir = heirs.find(h => h.id === old.heir) || heirs[0];
        const res = Relationships.succeedAsHeir(old, heir.id, world, { cause });
        if (res.success) return { how: 'heir', name: old.name };
    }
    // No heir of the main line: the nearest cadet branch's head (systems/cadetBranches.js)
    const branch = CadetBranches.heirLine(old)[0];
    if (branch) {
        const res = CadetBranches.succeed(old, world, branch.id, { cause });
        if (res.success) return { how: 'cadet', name: old.name };
    }
    Afterlife.begin(old, world, cause);
    const cand = Afterlife.candidates(world)[0];
    if (!cand) return { how: null, name: null };
    const res = Afterlife.becomeStranger(old, world, cand);
    if (!res.success) return { how: null, name: null };
    game.player = res.player;
    return { how: 'stranger', name: res.player.name };
}
