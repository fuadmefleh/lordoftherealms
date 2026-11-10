// ============================================
// WILDERNESS ACTIONS — Actions available on any tile (wilderness, settlement, or otherwise)
// Called by PlayerActions.getAvailableActions in index.js.
// These are actions that are always considered regardless of settlement presence.
// ============================================

import { Hex } from '../../core/hex.js';
import { Colonization } from '../../world/colonization.js';
import { Cartography } from '../../systems/cartography.js';
import { Religion } from '../../systems/religion.js';
import { Infrastructure } from '../../systems/infrastructure.js';
import { Technology } from '../../systems/technology.js';
import { Culture } from '../../systems/culture.js';
import { PlayerEconomy } from '../playerEconomy.js';
import { SeasonalWork } from '../seasonalWork.js';
import { Delves } from '../../systems/delves.js';
import { Sieges } from '../../systems/sieges.js';
import { OutlawLairs } from '../../systems/outlawLairs.js';
import { MerchantCaravans } from '../../systems/merchantCaravans.js';
import { CourierRiders } from '../../systems/courierRiders.js';
import { Hospitality } from '../../systems/hospitality.js';
import { Livestock } from '../../systems/livestock.js';
import { RivalHouses } from '../../systems/rivalHouses.js';
import { DawnBirth } from '../dawnBirth.js';

export function addWildernessActions(actions, player, tile, world) {
    // The tongues you speak and the one spoken here; lessons and interpreters in town (systems/languages.js)
    if (tile.settlement || tile.kingdom) {
        actions.push({ type: 'languages', label: 'Languages', icon: '🗣️', description: 'The tongue spoken here and yours: lessons with a tutor, an interpreter for hire' });
    }

    // The Dawn of Man: lead your clan to ground worth keeping, and stay (player/dawnBirth.js)
    if (DawnBirth.canSettleHere(player, world)) {
        const L = DawnBirth.data().lines || {};
        actions.push({ type: 'dawn_settle', label: L.settleAction || 'Make camp for good', icon: '🔥', description: L.settleDesc || 'Your clan settles here for good and founds a village.' });
    }

    // Meditate / Pray (anywhere on passable terrain)
    if (tile.terrain.passable) {
        actions.push({
            type: 'meditate',
            label: tile.holySite ? 'Pray at Holy Site' : 'Meditate',
            icon: '🧘',
            description: tile.holySite
                ? 'Pray here for greater spiritual benefit'
                : 'Quiet your mind to restore health and gain karma'
        });
    }

    // A roadhouse on the open road — the NPCs' or your own (systems/hospitality.js)
    if (!tile.settlement) {
        const houses = Hospitality.listAt(world, player, tile.q, tile.r);
        if (houses.length) {
            actions.push({
                type: 'lodging',
                label: `Stop at ${houses[0].name}`,
                icon: '🛏️',
                description: 'A roadhouse: a bunk or a room for the night, hot broth, a stable for your horse',
            });
            for (const v of houses.filter(h => h.owner === 'player')) {
                actions.push({ type: 'manage_lodging', unitId: v.id, label: `Run ${v.name}`, icon: '📒', description: 'Your roadhouse: prices, staff, guests and takings' });
            }
        }
    }

    // Personal Fishing (at coast/lake/river adjacent tiles)
    if (tile.terrain.passable) {
        const nearWater = Hex.neighbors(tile.q, tile.r).some(n => {
            const nt = world.getTile(n.q, n.r);
            return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
        });
        const isWaterTerrain = ['coast', 'beach'].includes(tile.terrain.id);
        if (nearWater || isWaterTerrain) {
            actions.push({
                type: 'fish',
                label: 'Go Fishing',
                icon: '🎣',
                description: 'Spend the day fishing — sell the catch or keep it as food'
            });
        }
    }

    // Prospect / Mine (hills, mountains, highlands)
    if (!tile.settlement && tile.terrain.passable) {
        const miningTerrains = ['hills', 'highlands', 'mountain'];
        if (miningTerrains.includes(tile.terrain.id)) {
            actions.push({
                type: 'prospect',
                label: 'Prospect',
                icon: '⛏️',
                description: 'Search for ore and minerals in the rock'
            });
        }
    }

    // Tame Horse (plains/grassland with horse resource)
    if (!tile.settlement && tile.terrain.passable && tile.resource && tile.resource.id === 'horses') {
        actions.push({
            type: 'tame_horse',
            label: 'Tame Wild Horse',
            icon: '🐴',
            description: 'Attempt to capture and tame a wild horse for faster travel'
        });
    }

    // Set up Camp / Craft (wilderness with wood)
    if (!tile.settlement && tile.terrain.passable && player.inventory) {
        const hasWood = (player.inventory.wood || 0) >= 2;
        if (hasWood) {
            actions.push({
                type: 'craft_campfire',
                label: 'Build Campfire',
                icon: '🔥',
                description: 'Use 2 wood to build a campfire — cook food and rest well (+extra health)'
            });
        }
    }

    // Foraging (non-settlement passable terrain)
    if (!tile.settlement && tile.terrain.passable) {
        const foragingTerrains = ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest',
            'temperate_rainforest', 'tropical_rainforest', 'plains', 'grassland', 'steppe', 'savanna',
            'hills', 'highlands', 'mountain', 'coast', 'beach', 'desert', 'arid', 'semi_arid',
            'swamp', 'marsh', 'wetland', 'mangrove', 'tropical_wetland'];
        if (foragingTerrains.includes(tile.terrain.id)) {
            actions.push({
                type: 'forage',
                label: 'Forage',
                icon: '🌿',
                description: 'Search the area for herbs, berries, and useful materials'
            });
        }
    }

    // Hunting (wilderness with game)
    if (!tile.settlement && tile.terrain.passable) {
        const huntingTerrains = ['forest', 'dense_forest', 'woodland', 'boreal_forest', 'seasonal_forest',
            'temperate_rainforest', 'tropical_rainforest', 'plains', 'grassland', 'steppe', 'savanna',
            'hills', 'highlands', 'coast', 'beach'];
        if (huntingTerrains.includes(tile.terrain.id)) {
            actions.push({
                type: 'hunt',
                label: 'Hunt',
                icon: '🏹',
                description: 'Hunt wild game for meat and pelts to sell'
            });
        }
    }

    // Winter work on cold ground (player/seasonalWork.js)
    if (SeasonalWork.canTrapFurs(tile, world)) {
        const line = SeasonalWork.trapLineAt(player, tile.q, tile.r);
        actions.push(line ? {
            type: 'trap_furs',
            label: 'Check Trap Line',
            icon: '🕸️',
            description: line.damaged ? 'Your snares here were wrecked — mend and re-bait them' : 'Empty your snares, re-bait them or take the line up'
        } : {
            type: 'trap_furs',
            label: 'Trap Furs',
            icon: '🦊',
            description: 'Run the traps for a day, or lay a trap line to fill over the coming days'
        });
    }

    // Jailer: a fugitive run to ground out in the wilds (systems/titles.js)
    const fug = player.currentTitle === 'jailer' ? player.activeFugitive : null;
    if (fug && !tile.settlement && fug.q === tile.q && fug.r === tile.r) {
        actions.push({
            type: 'capture_fugitive',
            label: '⚔️ Capture Fugitive',
            icon: '🔒',
            description: `Attempt to take ${fug.name} (difficulty ${fug.difficulty})`,
        });
    }
    if (SeasonalWork.canIceFish(tile, world)) {
        actions.push({
            type: 'ice_fish',
            label: 'Ice Fishing',
            icon: '❄️',
            description: 'Cut a hole in the ice and fish the frozen water'
        });
    }

    // Explore Point of Interest
    if (tile.improvement) {
        if (tile.improvement.explored === undefined) {
            tile.improvement.explored = false;
        }
        const delving = Delves.active(player);
        if (delving && delving.q === tile.q && delving.r === tile.r) {
            actions.push({
                type: 'delve_resume',
                label: `Resume Delve: ${delving.name}`,
                icon: '🕯️',
                description: 'Go back down into the chamber where you left off',
                notice: 'A delve left unfinished',
            });
        } else if (Delves.isDelveSite(tile)) {
            const site = Delves.siteInfo(tile);
            actions.push({
                type: 'delve',
                label: `Delve into ${tile.improvement.name}`,
                icon: (site && site.icon) || '🕯️',
                description: `${site ? site.name : 'A deep place'}: descend chamber by chamber — turn back whenever you like with what you've found`
            });
        } else if (!tile.improvement.explored && tile.improvement.type !== 'treasure_cache') {
            actions.push({
                type: 'explore_poi',
                label: `Explore ${tile.improvement.name}`,
                icon: '🔍',
                description: 'Search this location for treasure, knowledge, or danger'
            });
        }
    }

    // An outlaw lair here or next door (systems/outlawLairs.js)
    const lair = OutlawLairs.lairNear(player, world, tile.q, tile.r, 1);
    if (lair) {
        const kind = OutlawLairs.kind(lair.kind) || {};
        actions.push({
            type: 'outlaw_lair',
            label: `Outlaw Lair: ${lair.name}`,
            icon: kind.icon || '🏕️',
            description: `${lair.leader.slain ? 'A leaderless band' : lair.leader.name} — scout it, storm it, strike at the chief${kind.parley ? ', or bargain' : ''}`,
            lairId: lair.id,
        });
    }

    // Clear Trees (forest tiles without buildings)
    const forestTerrains = ['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'forest', 'dense_forest'];
    if (forestTerrains.includes(tile.terrain.id) && !tile.settlement && !tile.playerProperty) {
        actions.push({
            type: 'clear_trees',
            label: 'Clear Trees',
            icon: '🌲',
            description: 'Fell the trees for wood and clear the land for farming'
        });
    }

    // Terraform (flatten hills to grassland)
    if (!tile.settlement && tile.terrain.passable && tile.terrain.id === 'hills' && !tile.playerProperty) {
        actions.push({
            type: 'terraform',
            label: 'Terraform Land',
            icon: '⛏️',
            description: 'Flatten the hills into grassland (costs gold and AP)'
        });
    }

    // Build Property (empty wilderness tiles, or at settlements for taverns/workshops etc.)
    if (tile.terrain.passable && !tile.structure && !tile.improvement) {
        const hasSettlement = tile.settlement && tile.settlement.type;
        const noPropertyYet = !tile.playerProperty;
        if (hasSettlement || noPropertyYet) {
            actions.push({
                type: 'build_property',
                label: 'Build Property',
                icon: '🏗️',
                description: 'Construct a resource gathering building'
            });
        }
    }

    // Build Temple (empty passable spot with religion)
    if ((!tile.settlement || tile.settlement.type) && !tile.playerProperty && !tile.improvement && tile.terrain.passable) {
        actions.push({
            type: 'build_temple',
            label: 'Build Temple',
            icon: '⛩️',
            description: 'Construct a place of worship'
        });
    }

    // Property Interaction (manage existing property)
    if (tile.playerProperty) {
        actions.push({
            type: 'manage_property',
            label: 'Manage Property',
            icon: '🛠️',
            description: 'Collect goods, upgrade, or send caravans'
        });

        const collectable = PlayerEconomy.getPropertiesAt(tile).find(p => p.produces && p.produces !== 'gold' && p.storage > 0);
        // ...and what your beasts kept here have laid, given and grown (systems/livestock.js)
        const herdStore = Object.keys(Livestock.storeAt(player, tile.q, tile.r));
        if (collectable || herdStore.length) {
            actions.push({
                type: 'collect_goods',
                label: 'Collect Goods',
                icon: '📦',
                description: `Collect stored ${[collectable && collectable.produces, ...herdStore].filter(Boolean).join(', ')}`
            });
        }
        if (!tile.settlement && Livestock.state(player).herds.some(h => h.animals.length && h.place.q === tile.q && h.place.r === tile.r)) {
            actions.push({
                type: 'my_herds',
                label: 'Your Herds',
                icon: '🐑',
                description: 'Your beasts here and everywhere: fodder, births, eggs, milk and wool'
            });
        }
    }

    // Build Infrastructure (roads, bridges, irrigation)
    if (typeof Infrastructure !== 'undefined' && typeof Technology !== 'undefined' && tile.terrain.passable) {
        const availableInfra = Infrastructure.getAvailableTypes(player, tile, world);
        if (availableInfra.length > 0) {
            actions.push({
                type: 'build_infrastructure',
                label: 'Build Infrastructure',
                icon: '🛤️',
                description: 'Construct roads, bridges, irrigation or a jetty'
            });
        }
    }

    // Demolish Infrastructure
    if (tile.infrastructure) {
        actions.push({
            type: 'demolish_infrastructure',
            label: `Demolish ${tile.infrastructure.name}`,
            icon: '🗑️',
            description: 'Remove infrastructure (25% refund)'
        });
    }

    // Cultural Buildings
    if (typeof Culture !== 'undefined' && tile.terrain.passable && !tile.culturalBuilding && !tile.playerProperty && !tile.religiousBuilding) {
        actions.push({
            type: 'build_cultural',
            label: 'Build Cultural Building',
            icon: '📚',
            description: 'Construct a library, theater, university, or monument'
        });
    }

    // Upgrade your own cultural building
    if (typeof Culture !== 'undefined' && tile.culturalBuilding && tile.culturalBuilding.owner === 'player'
        && !tile.culturalBuilding.underConstruction && Culture.getUpgradeCost(tile.culturalBuilding) !== null) {
        const cb = tile.culturalBuilding;
        actions.push({
            type: 'upgrade_cultural',
            label: `Upgrade ${cb.name} (Lv ${cb.level || 1} → ${(cb.level || 1) + 1})`,
            icon: '📚',
            description: `${Culture.getUpgradeCost(cb)} gold — more income, influence and research`
        });
    }

    // Pilgrimage (at holy sites)
    if (typeof Religion !== 'undefined' && tile.holySite) {
        actions.push({
            type: 'pilgrimage',
            label: 'Visit Holy Site',
            icon: '⛲',
            description: `Visit ${tile.holySite.name} — gain gold, karma, and renown`
        });
    }

    // Colonization Actions
    if (typeof Colonization !== 'undefined') {
        // Out in the wilds (not in a settlement, on ground you can walk): offered,
        // greyed with the reason when you can't found one here yet
        if (!tile.settlement && tile.terrain && tile.terrain.passable) {
            const can = Colonization.canPlayerFoundColony(player, tile, world, player.q, player.r);
            actions.push({
                type: 'found_colony',
                label: 'Found Colony',
                icon: '🏴',
                description: `Establish a frontier colony here (${Colonization.COLONY_COST} gold)`,
                disabled: !can.can,
                reason: can.can ? null : `${can.reason}${/Too close/.test(can.reason || '') ? ` (at least ${Colonization.MIN_SETTLEMENT_DISTANCE} hexes from any town)` : ''}`,
            });
        }

        if (player.gold >= 200 && tile.settlement &&
            tile.settlement.colony && tile.settlement.colony.isPlayerColony) {
            actions.push({
                type: 'send_pioneers',
                label: 'Send Pioneers',
                icon: '🧭',
                description: 'Dispatch a pioneering party to settle distant lands (200 gold)'
            });
        }

        if (tile.settlement && tile.settlement.colony &&
            (tile.settlement.colony.isPlayerColony || tile.settlement.kingdom === player.allegiance)) {
            actions.push({
                type: 'manage_colony',
                label: 'Manage Colony',
                icon: '📋',
                description: `Manage ${tile.settlement.name} — loyalty, garrison, indigenous relations`
            });
        }

        if (tile.indigenous && tile.indigenous.population > 0) {
            actions.push({
                type: 'negotiate_indigenous',
                label: 'Negotiate with Natives',
                icon: '🤝',
                description: `Meet with the ${tile.indigenous.name} (${tile.indigenous.population} people)`
            });
        }
    }

    // At sea aboard your own ship: go up on deck (world/innerMap/harbour.js)
    if (!tile.terrain.passable && player.boardedShip && player.q === tile.q && player.r === tile.r) {
        actions.push({ type: 'explore_inner_map', label: 'Go on Deck', icon: '⛵', description: 'Walk the deck of your ship, the open sea all round' });
    }

    // Enter Inner Map (player's current tile, passable land)
    if (tile.terrain.passable && player.q === tile.q && player.r === tile.r) {
        actions.push({
            type: 'explore_inner_map',
            label: 'Explore Interior',
            icon: '🗺️',
            description: 'Enter the detailed inner map of this tile to explore on foot'
        });
    }

    // Bathe: free in a river, a lake or the sea; a copper or few at a village well or a town bathhouse (player/core/needs.js)
    if (player.q === tile.q && player.r === tile.r && player.needsEnabled && player.bathePlace && player.needs) {
        const place = player.bathePlace(world);
        if (place && player.needs.hygiene < 95) {
            const cs = player.clothesState ? player.clothesState() : null;
            actions.push({
                type: 'bathe',
                label: place.label,
                icon: place.kind === 'bathhouse' ? '🛁' : '🧼',
                cost: place.cost || undefined,
                description: `${place.kind === 'wild' ? `A wash in ${place.where} — free, and cold out of summer` : `${place.cost} gold at ${place.where}`}. Hygiene ${Math.round(player.needs.hygiene)}%${cs && cs.capped ? `; your ${cs.label.toLowerCase()} clothes get scrubbed too, so you can get properly clean` : ''}.`,
            });
        }
    }

    // Wash your clothes by hand at a river, the shore or a town's well (player/core/needs.js)
    if (player.q === tile.q && player.r === tile.r && player.needsEnabled && player.washWaterHere && player.clothesState) {
        const where = player.washWaterHere(world);
        const cs = player.clothesState();
        if (where && cs.freshness < 80) {
            actions.push({
                type: 'wash_clothes',
                label: 'Wash Clothes',
                icon: '🧺',
                description: `Scrub your clothes at ${where}. They are ${cs.label.toLowerCase()} (${cs.freshness}%)${cs.capped ? `: you can't get cleaner than ${cs.cap}% hygiene in them` : ''}.`
            });
        }
    }

    // Cartography Actions
    if (typeof Cartography !== 'undefined') {
        if (tile.terrain.passable) {
            // Charting is done on foot, one tile at a time (systems/cartography/charting.js)
            if (player.q === tile.q && player.r === tile.r && !Cartography.isCharted(player, tile.q, tile.r)) {
                const charted = Cartography.draftCount(player);
                actions.push({
                    type: 'chart_tile',
                    label: 'Chart This Tile',
                    icon: '📏',
                    description: `Survey and sketch this tile for a map${charted ? ` (${charted} charted so far)` : ''}`
                });
            }
            actions.push({
                type: 'cartography',
                label: 'Cartography',
                icon: '🗺️',
                description: 'Draw a map from the tiles you have charted, or manage your collection'
            });
        }

        if (tile.settlement) {
            actions.push({
                type: 'map_trade',
                label: 'Map Trader',
                icon: '📜',
                description: 'Buy or sell maps at this settlement'
            });
        }

        if (tile.settlement && tile.settlement.type !== 'village') {
            actions.push({
                type: 'steal_map',
                label: 'Steal Maps',
                icon: '🗡️',
                description: 'Attempt to steal maps from local archives (risky)'
            });
        }

        if (tile.improvement && tile.improvement.type === 'treasure_cache' && !tile.improvement.explored) {
            actions.push({
                type: 'dig_treasure',
                label: 'Dig for Treasure',
                icon: '💎',
                description: 'Dig at the marked location for buried treasure'
            });
        }
    }

    // The siege in progress here (systems/sieges.js): its camp, not a fresh attack
    const siegeHere = tile.settlement && Sieges.activeAt(player, tile.q, tile.r);
    if (siegeHere) {
        actions.push({
            type: 'siege_camp',
            label: `Siege of ${tile.settlement.name} (day ${(world.day || 0) - siegeHere.startDay})`,
            icon: '🏰',
            description: 'Your camp before the walls: stance, siege works, storm, terms, relief',
        });
    }

    // Attack settlement
    if (tile.settlement && !siegeHere && player.army && player.army.length > 0) {
        const isOwnColony = tile.settlement.colony && tile.settlement.colony.isPlayerColony;
        const isOwnKingdom = player.allegiance && tile.settlement.kingdom === player.allegiance;
        if (!isOwnColony && !isOwnKingdom) {
            actions.push({
                type: 'attack_settlement',
                label: `Attack ${tile.settlement.name}`,
                icon: '🏰',
                description: `Lay siege to ${tile.settlement.name} to conquer it, or raid it for plunder`,
            });
        }
    }

    // Attack world units on same tile
    if (world.units && world.units.length > 0) {
        // (never one's own clan at the Dawn of Man: they are family)
        const unitsOnTile = world.units.filter(u => u.q === player.q && u.r === player.r && !u.destroyed
            && !(u.kinOfPlayer && u.id === player.dawnClan));
        for (const unit of unitsOnTile) {
            actions.push({
                type: 'attack_unit',
                label: `Attack ${unit.name}`,
                icon: '⚔️',
                description: `Engage the ${unit.name} (Strength: ${unit.strength}, Pop: ${unit.population})`,
                unitId: unit.id
            });
        }
    }

    // Merchant caravans and trading ships passing by (systems/merchantCaravans.js):
    // trade with them, hire on as escort, or rob them
    for (const trader of MerchantCaravans.meetable(player, world)) {
        actions.push({
            type: 'meet_trader',
            label: `Hail the ${trader.name}`,
            icon: trader.icon || '🐫',
            description: `${(trader.house && trader.house.name) || 'Merchants'} bound for ${trader.toName}: trade, hire on as escort, or rob it`,
            unitId: trader.id,
        });
    }

    // Post riders on the road (systems/courierRiders.js): hail them, or rob them
    for (const rider of CourierRiders.meetable(player, world)) {
        actions.push({
            type: 'meet_courier',
            label: `Hail the ${rider.name}`,
            icon: rider.icon || '🏇',
            description: rider.letterId != null
                ? `Carrying your letter to ${rider.toWhom || rider.toName}`
                : `${rider.houseName} riding for ${rider.toName}${rider.own ? ' (your house)' : ': hail them, or rob the mailbag'}`,
            unitId: rider.id,
        });
    }

    // A rival House's head and retinue within a hex (systems/rivalHouses.js)
    for (const u of RivalHouses.meetable(player, world)) {
        const rival = RivalHouses.rivalOfUnit(player, u);
        if (!rival) continue;
        actions.push({
            type: 'meet_rival_house',
            label: `Meet ${RivalHouses.headName(rival)}`,
            icon: '🏰',
            description: `The head of ${rival.name}, your rival (feud ${Math.round(rival.feud || 0)}): ${RivalHouses.doing(world, rival)}`,
            unitId: u.id,
        });
    }

    // Request meeting with NPC lord on same tile
    if (world.units && world.units.length > 0) {
        const lordParties = world.units.filter(u => u.type === 'lord_party' && u.q === player.q && u.r === player.r && !u.destroyed);
        for (const lordUnit of lordParties) {
            const kingdom = world.getKingdom(lordUnit.kingdomId);
            if (kingdom && kingdom.lord) {
                actions.push({
                    type: 'request_meeting',
                    label: `Meet Lord ${lordUnit.lordName}`,
                    icon: '👑',
                    description: `Request an audience with ${lordUnit.lordName}, ruler of ${kingdom.name}`,
                    unitId: lordUnit.id
                });
            }
        }
    }

    // Miracles (high karma)
    if (player.karma >= 10) {
        actions.push({
            type: 'miracle',
            label: 'Perform Miracle',
            icon: '✨',
            description: 'Use karma to invoke divine intervention'
        });
    }
}
