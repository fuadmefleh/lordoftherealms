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

export function addWildernessActions(actions, player, tile, world) {
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

    // Explore Point of Interest
    if (tile.improvement) {
        if (tile.improvement.explored === undefined) {
            tile.improvement.explored = false;
        }
        if (!tile.improvement.explored && tile.improvement.type !== 'treasure_cache') {
            actions.push({
                type: 'explore_poi',
                label: `Explore ${tile.improvement.name}`,
                icon: '🔍',
                description: 'Search this location for treasure, knowledge, or danger'
            });
        }
    }

    // Clear Trees (forest tiles without buildings)
    const forestTerrains = ['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'forest', 'dense_forest'];
    if (forestTerrains.includes(tile.terrain.id) && !tile.settlement && !tile.playerProperty) {
        actions.push({
            type: 'clear_trees',
            label: 'Clear Trees',
            icon: '🪓',
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

        if (tile.playerProperty.produces && tile.playerProperty.storage && tile.playerProperty.storage > 0) {
            actions.push({
                type: 'collect_goods',
                label: 'Collect Goods',
                icon: '📦',
                description: `Collect stored ${tile.playerProperty.produces}`
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
                description: 'Construct roads, bridges, or irrigation'
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
        if (Colonization.canPlayerFoundColony(player, tile, world, player.q, player.r).can) {
            actions.push({
                type: 'found_colony',
                label: 'Found Colony',
                icon: '🏴',
                description: `Establish a frontier colony here (${Colonization.COLONY_COST} gold)`
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
                description: `Meet with the ${tile.indigenous.tribeName} (${tile.indigenous.population} people)`
            });
        }
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

    // Cartography Actions
    if (typeof Cartography !== 'undefined') {
        if (tile.terrain.passable) {
            actions.push({
                type: 'cartography',
                label: 'Cartography',
                icon: '🗺️',
                description: 'Create maps, manage your collection, or trade maps'
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

    // Attack settlement
    if (tile.settlement && player.army && player.army.length > 0) {
        const isOwnColony = tile.settlement.colony && tile.settlement.colony.isPlayerColony;
        const isOwnKingdom = player.allegiance && tile.settlement.kingdom === player.allegiance;
        if (!isOwnColony && !isOwnKingdom) {
            actions.push({
                type: 'attack_settlement',
                label: `Attack ${tile.settlement.name}`,
                icon: '🏰',
                description: `Lay siege to ${tile.settlement.name} and attempt to conquer it`,
            });
        }
    }

    // Attack world units on same tile
    if (world.units && world.units.length > 0) {
        const unitsOnTile = world.units.filter(u => u.q === player.q && u.r === player.r && !u.destroyed);
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
