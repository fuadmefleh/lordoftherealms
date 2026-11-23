// ============================================
// WORLD PARAMS — the New Game sheet's settings as World.generate params
// ============================================
//
// One place that turns the New Game screen's settings into the size and the
// generation params of the world: startNewGame (gameSetup.js) generates from
// it, and the screen's world preview (components/WorldPreview.jsx, through
// worldPreview.worker.js) shows the land it gives, so the world made is the
// world previewed. Light on purpose (it is imported by the preview's worker).

import { Dawn } from '../../world/dawn.js';

/**
 * @param {Object} s - New Game settings (components/SettingsScreen.jsx, or _readSettingsFromDOM)
 * @returns {{ width: number, height: number, startYear: number, dawnStart: boolean, params: Object }}
 *   `params` is what World.generate takes (its `seed` null when none was given: generate draws one)
 */
export function newWorldParams(s = {}) {
    const width = parseInt(s.worldWidth) || 120;
    const height = parseInt(s.worldHeight) || 80;
    // The calendar's first year; before the dawn year there are no towns or realms yet (world/dawn.js)
    // (a hand-made map can't begin at the Dawn of Man: it has no wandering clans)
    const startYear = Math.max(s.customWorldId ? Dawn.dawnYear() : 1, parseInt(s.startYear) || 853);
    const dawnStart = Dawn.isDawnStart({ startYear });
    const seed = (typeof s.mapSeed === 'string' ? s.mapSeed.trim() : s.mapSeed) || null;
    const params = {
        seed,
        // Current terrain generator: 2 = peaks on land, rivers that reach the
        // sea; 3 = generated with the true hex distance (core/hex.js); 4 =
        // towns built in their culture's own architecture (data/architecture.json); 5 = towns
        // with a churchyard planned beside the church (world/churchyard.js); 6 = a start
        // year before the mature year ages the world back (world/worldAge.js); 7 = a town's house
        // mix humbler or grander by its wealth (world/settlementWealth.js, world/townPlanner.js); 8 =
        // towns that age through architectural eras, weather, rebuild, pave and wall themselves (world/townEras.js); 9 =
        // bigger crags in up to three tiers, with caves in their faces (world/innerMap/cliffs.js, mines.js); 10 =
        // water that drains as water does: branching river systems and lakes in the hollows (Terrain.generateHydrology)
        // 11 = lakes in the valleys, dammed on their rivers and filled along the contours (Terrain._valleyLakes)
        // 12 = mountain ranges along tectonic plate seams; a climate of prevailing winds, rain shadows,
        // colder heights and greener riverbanks (Terrain._plates, _climate12, _riverbanks12)
        // 13 = subtropical desert belts; narrower, more broken mountain chains (Terrain._climate12, _plates)
        // 14 = continents of several lobes, archipelagos, finer coasts, winding straits; the land's
        // heights from its relief (ranges, foothills, rolling hills), so a continent's heart can be
        // a plain; snow only on the highest crags (Terrain._land11 relief, _seaLevel11)
        // 15 = mined things (iron, coal, copper, silver, gold, gems, salt, oil) lie in a few ore fields,
        // so lands trade for what they lack; stone, timber and the rest stay everywhere (Terrain._mineralFields)
        // 16 = mountain passes through the long ranges, fjords, beaches and skerries, marshes and river
        // deltas, and towns sited at river mouths, confluences, fords and lake shores
        // (Terrain._passes16, _fjords16, _shores16, _wetlands16; world/townSiting.js)
        // 17 = history in the land (ruins on good empty sites, pass forts, old mines, old roads),
        // glaciers, badlands and canyons, volcanoes with hot springs, coral reefs, fishing grounds
        // on the shelves and currents, natural fords, roads built through the passes
        // (world/landHistory.js, landscapes17.js, rivers.js, mountainBarriers.js; Terrain._fishingGrounds17)
        terrainGen: 17,
        continentCount: parseInt(s.continentCount) || 3,
        terrainFreq: parseFloat(s.terrainFreq) || 1.1,
        riverCount: parseInt(s.riverCount) || 40,
        waterThreshold: parseFloat(s.waterLevel) || 0.42,
        continentSize: s.continentSize || 'medium',
        islandFreq: parseFloat(s.islandFreq) || 1.0,
        landMass: parseInt(s.landMass) || 45,
        mountainDensity: parseInt(s.mountainDensity) || 100,
        hillDensity: parseInt(s.hillDensity) || 100,
        flatness: s.flatness || 'normal',
        temperature: s.temperature || 'normal',
        rainfall: s.rainfall || 'normal',
        polarIce: s.polarIce || 'normal',
        desertFreq: s.desertFreq || 'normal',
        forestDensity: parseInt(s.forestDensity) || 100,
        lakeFreq: s.lakeFreq || 'normal',
        resourceDensity: s.resourceDensity || 'normal',
        strategicRes: s.strategicRes || 'normal',
        terrainOctaves: parseInt(s.terrainOctaves) || 6,
        heatFreq: parseFloat(s.heatFreq) || 3.0,
        moistFreq: parseFloat(s.moistFreq) || 2.0,
        coastalDetail: parseInt(s.coastalDetail) || 5,
        deepWaterLevel: parseFloat(s.deepWaterLevel) || 0.20,
        hillsLevel: parseFloat(s.hillsLevel) || 0.52,
        mountainLevel: parseFloat(s.mountainLevel) || 0.70,
        snowPeakLevel: parseFloat(s.snowPeakLevel) || 0.88,
        kingdomCount: parseInt(s.kingdomCount) || 6,
        startYear,
        independentSettlements: s.independentSettlements || 'normal',
        ruinsFreq: s.ruinsFreq || 'normal',
    };
    return { width, height, startYear, dawnStart, params };
}
