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

import { DataLoader } from '../../core/dataLoader.js';
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
import { House } from '../../systems/house.js';
import { Schemes } from '../../systems/schemes.js';
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
import { Sagas } from '../../systems/sagas.js';
import { Sieges } from '../../systems/sieges.js';
import { HoldingSieges } from '../../systems/holdingSieges.js';
import { Discovery } from '../../systems/discovery.js';
import { Holdings } from '../../systems/holdings.js';
import { Upbringing } from '../../systems/upbringing.js';
import { MerchantHouses } from '../../systems/merchantHouses.js';
import { Heralds } from '../../systems/heralds.js';
import { Patronage } from '../../systems/patronage.js';
import { OutlawLairs } from '../../systems/outlawLairs.js';
import { MerchantCaravans } from '../../systems/merchantCaravans.js';
import { Finance } from '../../systems/finance.js';
import { MarketFairs } from '../../systems/marketFairs.js';
import { MerchantPrince } from '../../systems/merchantPrince.js';
import { Labour } from '../../systems/labour.js';
import { Guilds } from '../../systems/guilds.js';
import { PriceKnowledge } from '../../systems/priceKnowledge.js';
import { TradePolicy } from '../../systems/tradePolicy.js';
import { resolveHostileEncounter } from '../../ui/game/combat.logic.js';

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
export function newGame(seed) {
    Utils.setSeed(seed);
    const world = new World(WORLD_W, WORLD_H);
    world.generate({ ...GEN });
    const player = new Player({ firstName: 'Bot', lastName: 'Harness', gender: 'male', age: 20 });
    player.placeInWorld(world);

    Quests.initialize(player);
    Quests.grantStarterQuest(player, world);
    Achievements.initialize(player);
    MarketDynamics.initialize();
    Technology.initPlayer(player);
    Relationships.initialize(player);
    House.initialize(player, world);
    House.seedRivals(player, world);
    if (!player.taxRate) player.taxRate = 'moderate';
    Titles.initialize(player);
    Councils.initializePlayer(player);
    player.updateVisibility(world, 4);
    return { seed, world, player, log: [] };
}

/** ui/game/combat.js _checkHostileEncounters, minus audio/notifications. */
function checkHostileEncounters(game) {
    const { world, player } = game;
    if (player.indenturedServitude) return null;
    if (PlayerReligion.isInSanctuary(player, player.q, player.r, world.width)) return null;
    const hostiles = world.units.filter(u =>
        !u.destroyed &&
        !u.sparesPlayer &&
        WorldUnit.HOSTILE_TYPES.includes(u.type) &&
        Hex.wrappingDistance(u.q, u.r, player.q, player.r, world.width) <= 1);
    if (hostiles.length === 0) return null;
    const attacker = hostiles.reduce((a, b) => b.strength > a.strength ? b : a, hostiles[0]);
    return resolveHostileEncounter(player, attacker, world);
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
    const shipDay = Ships.processDaily(player, world);
    mark(game, 'Ships.processDaily');
    game.voyageDay = (shipDay && shipDay.voyage) || null;

    // Construction ticks (properties, religious, infrastructure, cultural)
    for (const propRef of player.properties || []) {
        const pTile = world.getTile(propRef.q, propRef.r);
        if (!pTile) continue;
        const prop = PlayerEconomy.findPropertyAt(pTile, propRef.type);
        if (prop && prop.underConstruction && prop.constructionDaysLeft > 0) {
            prop.constructionDaysLeft--;
            if (prop.constructionDaysLeft <= 0) {
                prop.underConstruction = false;
                Quests.track(player, 'buildings_constructed');
            }
        }
    }
    for (const bRef of (player.religion && player.religion.buildings) || []) {
        const bTile = world.getTile(bRef.q, bRef.r);
        if (!bTile || !bTile.religiousBuilding) continue;
        const rb = bTile.religiousBuilding;
        if (rb.underConstruction && rb.constructionDaysLeft > 0) {
            rb.constructionDaysLeft--;
            if (rb.constructionDaysLeft <= 0) rb.underConstruction = false;
        }
    }
    if (player.infrastructureUnderConstruction) {
        for (let i = player.infrastructureUnderConstruction.length - 1; i >= 0; i--) {
            const ref = player.infrastructureUnderConstruction[i];
            const iTile = world.getTile(ref.q, ref.r);
            if (!iTile || !iTile.infrastructure || !iTile.infrastructure.underConstruction) {
                player.infrastructureUnderConstruction.splice(i, 1);
                continue;
            }
            iTile.infrastructure.constructionDaysLeft--;
            if (iTile.infrastructure.constructionDaysLeft <= 0) {
                iTile.infrastructure.underConstruction = false;
                player.infrastructureUnderConstruction.splice(i, 1);
            }
        }
    }
    for (const bRef of player.culturalBuildings || []) {
        const cTile = world.getTile(bRef.q, bRef.r);
        if (!cTile || !cTile.culturalBuilding) continue;
        const cb = cTile.culturalBuilding;
        if (cb.underConstruction && cb.constructionDaysLeft > 0) {
            cb.constructionDaysLeft--;
            if (cb.constructionDaysLeft <= 0) cb.underConstruction = false;
        }
    }

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
    Relationships.prepareForSave(player);
    mark(game, 'Relationships.prepareForSave');

    House.processDaily(player, world);
    mark(game, 'House.processDaily');
    Schemes.processDaily(player, world);
    mark(game, 'Schemes.processDaily');
    Petitions.processDay(player, world);
    mark(game, 'Petitions.processDay');
    Delves.processDay(world, player);
    mark(game, 'Delves.processDay');
    Rivals.processDay(world, player);
    mark(game, 'Rivals.processDay');
    Sagas.processDay(world, player);
    mark(game, 'Sagas.processDay');
    OutlawLairs.processDay(world, player);
    mark(game, 'OutlawLairs.processDay');
    game.discoveryDay = Discovery.processDay(world, player);
    mark(game, 'Discovery.processDay');
    RealmWars.processDaily(player, world);
    mark(game, 'RealmWars.processDaily');
    game.holdingSiegeDay = HoldingSieges.processDay(world, player);
    mark(game, 'HoldingSieges.processDay');
    Throne.processDaily(player, world, { armyStrength: PlayerMilitary.getArmyStrength(player) });
    mark(game, 'Throne.processDaily');
    Kingship.processDay(world, player);
    mark(game, 'Kingship.processDay');
    Sieges.processDay(world, player);
    mark(game, 'Sieges.processDay');
    Holdings.processDay(player, world);
    mark(game, 'Holdings.processDay');
    MerchantHouses.processDay(player, world);
    mark(game, 'MerchantHouses.processDay');
    game.patronageDay = Patronage.processDay(world, player);
    mark(game, 'Patronage.processDay');
    Heralds.processDay(world, player);
    mark(game, 'Heralds.processDay');
    game.caravanDay = MerchantCaravans.processDay(world, player);
    mark(game, 'MerchantCaravans.processDay');
    game.fairDay = MarketFairs.processDay(world, player);
    mark(game, 'MarketFairs.processDay');
    game.tradePolicyDay = TradePolicy.processDay(world, player);
    mark(game, 'TradePolicy.processDay');
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

    Tavern.expireOldIntel(player, world.day);
    mark(game, 'Tavern.expireOldIntel');
    Tavern.processInformants(player, world);
    mark(game, 'Tavern.processInformants');
    Espionage.processDaily(player, world);
    mark(game, 'Espionage.processDaily');
    Espionage.prepareForSave(player);
    mark(game, 'Espionage.prepareForSave');
    Gossip.processDaily(player, world);
    mark(game, 'Gossip.processDaily');
    game.financeDay = Finance.processDay(world, player);
    mark(game, 'Finance.processDay');
    if (world.day % 7 === 0) Taxation.collectTaxes(player, world);
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
    Achievements.checkAchievements(player, world);
    mark(game, 'Achievements.checkAchievements');
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
    if (kId) player.learnAboutKingdom(kId, 'basics');
    Rivals.onPlayerArrived(player, world, tile);
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
