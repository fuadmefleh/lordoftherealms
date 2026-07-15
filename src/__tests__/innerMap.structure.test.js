/**
 * Structural regression guard for the InnerMap monolith split.
 *
 * innerMap.js was split from one ~4k-line object literal into
 * src/world/innerMap/*.js group modules reassembled via Object.assign. This
 * asserts the assembled InnerMap still exposes every original member (data
 * fields + methods), so nothing was dropped or misplaced by the split.
 */
import { describe, it, expect } from 'vitest';
import { InnerMap } from '../world/innerMap.js';

const EXPECTED_MEMBERS = [
    'CONFIG', '_cache', '_timeCache', 'active', 'currentWorldTile', 'tiles', 'width', 'height',
    'playerInnerQ', 'playerInnerR', '_discoveredEncounters', 'timeOfDay', '_timeAccumulator',
    'TIME_SCALE', 'dayEnded', 'weather', 'temperature', 'season', '_playerPath', '_playerPathIndex',
    '_playerMoveProgress', '_playerPrevQ', '_playerPrevR', '_playerWalking', '_playerSpeed',
    '_playerArrivalResult', '_pendingInteraction', '_activeInteraction', '_pendingDialog', 'npcs',
    '_npcMoveTimer', 'buildings', 'roads', '_pendingPropertyPosition', '_insideBuilding',
    '_outerMapState', '_interiorCache', 'initialize', 'BUILDING_TYPES', 'PROPERTY_SPRITES',
    'PROPERTY_BUILDING_DEFS', 'SETTLEMENT_BUILDINGS', '_NPC_SHOP_POOLS', '_generateNpcShop',
    'NPC_TYPES', 'NPC_POOLS', 'INNER_MAP_SIZE', 'PARENT_TO_BASE_TERRAIN', 'SUB_TO_BASE_TERRAIN',
    '_getBaseTerrain', '_getGrassNineTileBrush', '_pickNineTileInfo', '_paintGrassSecondLayer',
    'getOrGenerate', '_refreshWeatherData', 'generate', '_buildDoorExclusionZone',
    '_scatterCustomObjects', '_pickAutoColorVariantIdx', 'BUILDING_SPRITES', 'DECORATION_SPRITES',
    '_placeBuildings', '_placeCustomBuildings', '_placePlayerProperties', '_findSuitablePropertyTile',
    '_getInnerMapDimensions', 'placePropertyOnInnerMap', '_addPropertyBuildings',
    '_assignBuildingOwners', '_defaultSubTerrains', 'enter', 'exit', 'INTERIOR_LAYOUTS',
    'INTERIOR_FLOORS', 'FURNITURE_COLORS', 'enterBuilding', 'exitBuilding', '_placeNpcInInterior',
    '_findPassableAdjacentTile', '_generateInterior', '_generateCustomInterior', 'movePlayer',
    'movePlayerTo', 'cancelPlayerWalk', 'startInteraction', '_computeObjectDamage', 'updateInteraction',
    '_removeCustomObject', 'findAdjacentPassable', 'findAdjacentToObject', 'getDirectionToward',
    'updatePlayer', 'getPlayerWorldPos', '_findPath', '_revealAround', 'getTile', 'getSummary',
    'serialize', 'deserialize', 'clearCache', 'updateTime', 'getCachedTimeForTile', 'getTimeString',
    'getTimePeriod', 'getAmbientOverlay', 'getWeatherOverlay', 'getTemperatureOverlay',
    '_buildBuildingList', '_generateRoads', 'getBuildingAt', 'getBuildingActions', '_spawnNPCs',
    'updateNPCs', '_findNearestEdgeTile', '_npcPickDestination', 'getNPCsAt',
];

describe('InnerMap split — structural equivalence', () => {
    it('exposes every original member (116)', () => {
        const keys = new Set(Object.keys(InnerMap));
        const missing = EXPECTED_MEMBERS.filter((k) => !keys.has(k));
        expect(missing).toEqual([]);
        expect(EXPECTED_MEMBERS).toHaveLength(116);
    });

    it('key methods are callable functions', () => {
        for (const m of ['generate', 'enter', 'movePlayer', 'updateNPCs', 'getTile', 'serialize']) {
            expect(typeof InnerMap[m], `${m}`).toBe('function');
        }
    });
});
