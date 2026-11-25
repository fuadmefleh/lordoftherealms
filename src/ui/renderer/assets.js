// Renderer — assets methods.
import { Renderer } from './core.js';
import { Hex, Religion, Economy, Infrastructure } from './_imports.js';

// Open water a painted river (no flow direction) runs out into
const RIVER_WATER_IDS = new Set(['ocean', 'deep_ocean', 'lake', 'sea', 'coast']);

// getTileImage's variant lists, made once (a fresh array for every hex, every frame, before)
const TV = {
    none: [],
    oceanCalm: ['ocean/hexOceanCalm00.png', 'ocean/hexOceanCalm01.png', 'ocean/hexOceanCalm02.png', 'ocean/hexOceanCalm03.png'],
    reef: ['ocean/hexReef00.png', 'ocean/hexReef01.png', 'ocean/hexReef02.png', 'ocean/hexReef03.png'],
    fjord: ['cold/hexFjord00.png', 'cold/hexFjord01.png', 'cold/hexFjord02.png', 'cold/hexFjord03.png'],
    skerry: ['cold/hexSkerry00.png', 'cold/hexSkerry01.png'],
    islandRocky: ['ocean/hexIslandRocky00.png', 'ocean/hexIslandRocky01.png'],
    islandSandy: ['ocean/hexIslandSandy00.png', 'ocean/hexIslandSandy01.png', 'ocean/hexIslandRocky00.png', 'ocean/hexIslandRocky01.png'],
    lake: ['ocean/hexLake00.png', 'ocean/hexLake01.png', 'ocean/hexLake02.png', 'ocean/hexLake03.png'],
    shingle: ['temperate/hexShingle00.png', 'temperate/hexShingle01.png', 'temperate/hexShingle02.png', 'temperate/hexShingle03.png'],
    sandPalms: ['tropics_wetlands/hexSandPalms00.png', 'tropics_wetlands/hexSandPalms01.png', 'tropics_wetlands/hexSandPalms02.png', 'tropics_wetlands/hexSandPalms03.png'],
    sand: ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png', 'tropics_wetlands/hexSand02.png', 'tropics_wetlands/hexSand03.png'],
    dirt: ['hexDirt01.png', 'hexDirt02.png'],
    plains: ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png'],
    forestBroadleaf: ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'],
    mountainSnow: ['cold/hexMountainSnow00.png', 'cold/hexMountainSnow01.png', 'cold/hexMountainSnow02.png', 'cold/hexMountainSnow03.png'],
    mountain: ['hexMountain01.png', 'hexMountain02.png', 'hexMountain03.png'],
    hillsColdSnowCovered: ['cold/hexHillsColdSnowCovered00.png', 'cold/hexHillsColdSnowCovered01.png', 'cold/hexHillsColdSnowCovered02.png', 'cold/hexHillsColdSnowCovered03.png'],
    hillsCold: ['cold/hexHillsCold00.png', 'cold/hexHillsCold01.png', 'cold/hexHillsCold02.png', 'cold/hexHillsCold03.png'],
    hills: ['hexHills01.png', 'hexHills02.png', 'hexHills03.png'],
    highlands: ['hexHighlands01.png', 'hexHighlands02.png', 'hexHighlands03.png'],
    swamp: ['tropics_wetlands/hexSwamp00.png', 'tropics_wetlands/hexSwamp01.png', 'tropics_wetlands/hexSwamp02.png', 'tropics_wetlands/hexSwamp03.png'],
    wetlands: ['tropics_wetlands/hexWetlands00.png', 'tropics_wetlands/hexWetlands01.png', 'tropics_wetlands/hexWetlands02.png', 'tropics_wetlands/hexWetlands03.png'],
    snowField: ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png', 'cold/hexSnowField03.png'],
    plainsCold: ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png', 'cold/hexPlainsCold02.png', 'cold/hexPlainsCold03.png'],
    scrublands: ['hexScrublands01.png', 'hexScrublands02.png', 'hexScrublands03.png'],
    glacierPeak: ['cold/hexGlacierPeak00.png', 'cold/hexGlacierPeak01.png'],
    glacier: ['cold/hexGlacier00.png', 'cold/hexGlacier01.png', 'cold/hexGlacier02.png', 'cold/hexGlacier03.png'],
    canyon: ['desert/hexCanyon00.png', 'desert/hexCanyon01.png', 'desert/hexCanyon02.png'],
    badlands: ['desert/hexBadlands00.png', 'desert/hexBadlands01.png', 'desert/hexBadlands02.png', 'desert/hexBadlands03.png'],
    volcano: ['volcanic/hexVolcano00.png', 'volcanic/hexVolcano01.png'],
    ashPlains: ['volcanic/hexAshPlains00.png', 'volcanic/hexAshPlains01.png', 'volcanic/hexAshPlains02.png', 'volcanic/hexAshPlains03.png'],
    pineSnow: ['cold/hexForestPine00.png', 'cold/hexForestPine01.png', 'cold/hexForestPine02.png', 'cold/hexForestPine03.png', 'cold/hexForestPineSnowCovered00.png', 'cold/hexForestPineSnowCovered01.png'],
    pine: ['cold/hexForestPine00.png', 'cold/hexForestPine01.png', 'cold/hexForestPine02.png', 'cold/hexForestPine03.png'],
    broadleafWoods: ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png', 'hexWoodlands01.png', 'hexWoodlands02.png', 'hexWoodlands03.png'],
    dunesRed: ['hexDesertDunes01.png', 'hexDesertDunes02.png', 'hexDesertDunes03.png', 'hexDesertRedForest00.png'],
    dunes: ['hexDesertDunes01.png', 'hexDesertDunes02.png', 'hexDesertDunes03.png'],
};
for (const k of Object.keys(TV)) Object.freeze(TV[k]);

Object.assign(Renderer.prototype, {
    /**
     * Load all terrain assets
     */
    async loadAssets() {
        const ASSET_PATH = 'assets/tiles/';
        const RIVER_PATH = 'assets/tiles/rivers/';

        // Mapping of terrain types to image variants
        const TERRAIN_IMAGES = {
            'ocean': ['hexOcean01.png', 'hexOcean02.png', 'hexOcean03.png'],
            'ocean_calm': ['ocean/hexOceanCalm00.png', 'ocean/hexOceanCalm01.png', 'ocean/hexOceanCalm02.png', 'ocean/hexOceanCalm03.png'],
            'ocean_lake': ['ocean/hexLake00.png', 'ocean/hexLake01.png', 'ocean/hexLake02.png', 'ocean/hexLake03.png'],
            'ocean_islands': ['ocean/hexIslandSandy00.png', 'ocean/hexIslandSandy01.png', 'ocean/hexIslandRocky00.png', 'ocean/hexIslandRocky01.png'],
            'shallows': ['hexOceanCalm02.png'],
            'plains': ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png', 'hexDirt01.png', 'hexDirt02.png'],
            'grassland': ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png'], // Grassland should be lush, no dirt
            'forest': ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png', 'hexWoodlands01.png', 'hexWoodlands02.png', 'hexWoodlands03.png'],
            'forest_cold': ['cold/hexForestPine00.png', 'cold/hexForestPine01.png', 'cold/hexForestPine02.png', 'cold/hexForestPine03.png', 'cold/hexForestPineSnowCovered00.png'],
            'desert': ['hexDesertDunes01.png', 'hexDesertDunes02.png', 'hexDesertDunes03.png', 'hexDesertRedForest00.png'],
            'mountain': ['hexMountain01.png', 'hexMountain02.png', 'hexMountain03.png'],
            'mountain_cold': ['cold/hexMountainSnow00.png', 'cold/hexMountainSnow01.png', 'cold/hexMountainSnow02.png', 'cold/hexMountainSnow03.png'],
            'hills': ['hexHills01.png', 'hexHills02.png', 'hexHills03.png'],
            'hills_cold': ['cold/hexHillsCold00.png', 'cold/hexHillsCold01.png', 'cold/hexHillsCold02.png', 'cold/hexHillsCold03.png'],
            'hills_frozen': ['cold/hexHillsColdSnowCovered00.png', 'cold/hexHillsColdSnowCovered01.png', 'cold/hexHillsColdSnowCovered02.png', 'cold/hexHillsColdSnowCovered03.png'],
            'swamp': ['hexMarsh00.png', 'hexMarsh01.png', 'hexMarsh02.png', 'hexMarsh03.png'],
            'snow': ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png', 'cold/hexSnowField03.png'],
            'tundra': ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png', 'cold/hexPlainsCold02.png', 'cold/hexPlainsCold03.png'],
            // terrainGen 16 coasts (scripts/terrain_art/coast_tiles.py): fjord water, cold rocky skerries, temperate shingle beaches
            'fjord': ['cold/hexFjord00.png', 'cold/hexFjord01.png', 'cold/hexFjord02.png', 'cold/hexFjord03.png'],
            'skerry': ['cold/hexSkerry00.png', 'cold/hexSkerry01.png'],
            'beach_temperate': ['temperate/hexShingle00.png', 'temperate/hexShingle01.png', 'temperate/hexShingle02.png', 'temperate/hexShingle03.png'],
            'ocean_cold': ['cold/hexOceanIceBergs00.png', 'cold/hexOceanIceBergs01.png', 'cold/hexOceanIceBergs02.png', 'cold/hexOceanIceBergs03.png'],
            'savanna': ['hexScrublands01.png', 'hexScrublands02.png', 'hexScrublands03.png'],
            'beach': [
                'tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png', 'tropics_wetlands/hexSand02.png', 'tropics_wetlands/hexSand03.png',
                'tropics_wetlands/hexSandPalms00.png', 'tropics_wetlands/hexSandPalms01.png', 'tropics_wetlands/hexSandPalms02.png', 'tropics_wetlands/hexSandPalms03.png'
            ],
            'wetlands': [
                'tropics_wetlands/hexSwamp00.png', 'tropics_wetlands/hexSwamp01.png', 'tropics_wetlands/hexSwamp02.png', 'tropics_wetlands/hexSwamp03.png',
                'tropics_wetlands/hexWetlands00.png', 'tropics_wetlands/hexWetlands01.png', 'tropics_wetlands/hexWetlands02.png', 'tropics_wetlands/hexWetlands03.png'
            ],
            'highlands': ['hexHighlands01.png', 'hexHighlands02.png', 'hexHighlands03.png'],
            // terrainGen 17 landscapes (scripts/terrain_art/landscape_tiles.py): glaciers, badlands and canyons, volcanoes, reefs
            'glacier': ['cold/hexGlacier00.png', 'cold/hexGlacier01.png', 'cold/hexGlacier02.png', 'cold/hexGlacier03.png', 'cold/hexGlacierPeak00.png', 'cold/hexGlacierPeak01.png'],
            'badlands': ['desert/hexBadlands00.png', 'desert/hexBadlands01.png', 'desert/hexBadlands02.png', 'desert/hexBadlands03.png', 'desert/hexCanyon00.png', 'desert/hexCanyon01.png', 'desert/hexCanyon02.png'],
            'volcano': ['volcanic/hexVolcano00.png', 'volcanic/hexVolcano01.png'],
            'ash_plains': ['volcanic/hexAshPlains00.png', 'volcanic/hexAshPlains01.png', 'volcanic/hexAshPlains02.png', 'volcanic/hexAshPlains03.png'],
            'reef': ['ocean/hexReef00.png', 'ocean/hexReef01.png', 'ocean/hexReef02.png', 'ocean/hexReef03.png']
        };

        const RIVER_IMAGES = [
            "hexRiver000000-00.png", "hexRiver000001-00.png", "hexRiver000010-00.png", "hexRiver000011-00.png",
            "hexRiver000011-01.png", "hexRiver000011-02.png", "hexRiver000100-00.png", "hexRiver000101-00.png",
            "hexRiver000101-01.png", "hexRiver000110-00.png", "hexRiver000110-01.png", "hexRiver000111-00.png",
            "hexRiver001000-00.png", "hexRiver001001-00.png", "hexRiver001001-01.png", "hexRiver001001-02.png",
            "hexRiver001010-00.png", "hexRiver001010-01.png", "hexRiver001011-00.png", "hexRiver001100-00.png",
            "hexRiver001101-00.png", "hexRiver001110-00.png", "hexRiver001111-00.png", "hexRiver010000-00.png",
            "hexRiver010001-00.png", "hexRiver010010-00.png", "hexRiver010010-01.png", "hexRiver010011-00.png",
            "hexRiver010100-00.png", "hexRiver010101-00.png", "hexRiver010110-00.png", "hexRiver010111-00.png",
            "hexRiver011000-00.png", "hexRiver011000-01.png", "hexRiver011001-00.png", "hexRiver011010-00.png",
            "hexRiver011011-00.png", "hexRiver011100-00.png", "hexRiver011101-00.png", "hexRiver011110-00.png",
            "hexRiver011111-00.png", "hexRiver100000-00.png", "hexRiver100001-00.png", "hexRiver100010-00.png",
            "hexRiver100011-00.png", "hexRiver100100-00.png", "hexRiver100100-01.png", "hexRiver100100-02.png",
            "hexRiver100101-00.png", "hexRiver100110-00.png", "hexRiver100111-00.png", "hexRiver101000-00.png",
            "hexRiver101001-00.png", "hexRiver101010-00.png", "hexRiver101011-00.png", "hexRiver101100-00.png",
            "hexRiver101101-00.png", "hexRiver101110-00.png", "hexRiver101111-00.png", "hexRiver110000-00.png",
            "hexRiver110000-01.png", "hexRiver110001-00.png", "hexRiver110010-00.png", "hexRiver110011-00.png",
            "hexRiver110100-00.png", "hexRiver110101-00.png", "hexRiver110110-00.png", "hexRiver110111-00.png",
            "hexRiver111000-00.png", "hexRiver111001-00.png", "hexRiver111010-00.png", "hexRiver111011-00.png",
            "hexRiver111100-00.png", "hexRiver111101-00.png", "hexRiver111110-00.png", "hexRiver111111-00.png"
        ];

        // Cache for variant lookup
        this.riverVariants = new Map();
        for (const img of RIVER_IMAGES) {
            // key: "000011" -> ["00", "01", "02"]
            const match = img.match(/hexRiver([01]{6})-(\d+).png/);
            if (match) {
                const key = match[1];
                if (!this.riverVariants.has(key)) {
                    this.riverVariants.set(key, []);
                }
                this.riverVariants.get(key).push(img);
            }
        }

        const ROAD_PATH = 'assets/tiles/roads/';
        const ROAD_IMAGES = [
            "hexRoadBridge-001001-00.png","hexRoadBridge-010010-00.png","hexRoadBridge-100100-00.png",
            "hexRoad-000001-00.png","hexRoad-000001-01.png","hexRoad-000001-02.png","hexRoad-000001-03.png",
            "hexRoad-000010-00.png","hexRoad-000010-01.png","hexRoad-000010-02.png","hexRoad-000010-03.png",
            "hexRoad-000011-00.png","hexRoad-000011-01.png","hexRoad-000011-02.png",
            "hexRoad-000100-00.png","hexRoad-000100-01.png","hexRoad-000100-02.png","hexRoad-000100-03.png",
            "hexRoad-000101-00.png","hexRoad-000101-01.png","hexRoad-000101-02.png",
            "hexRoad-000110-00.png","hexRoad-000110-01.png","hexRoad-000110-02.png",
            "hexRoad-000111-00.png","hexRoad-000111-01.png",
            "hexRoad-001000-00.png","hexRoad-001000-01.png","hexRoad-001000-02.png","hexRoad-001000-03.png",
            "hexRoad-001001-00.png","hexRoad-001001-01.png","hexRoad-001001-02.png",
            "hexRoad-001010-00.png","hexRoad-001010-01.png","hexRoad-001010-02.png",
            "hexRoad-001011-00.png",
            "hexRoad-001100-00.png","hexRoad-001100-01.png","hexRoad-001100-02.png",
            "hexRoad-001101-00.png",
            "hexRoad-001110-00.png","hexRoad-001110-01.png",
            "hexRoad-001111-00.png",
            "hexRoad-010000-00.png","hexRoad-010000-01.png","hexRoad-010000-02.png","hexRoad-010000-03.png",
            "hexRoad-010001-00.png","hexRoad-010001-01.png","hexRoad-010001-02.png",
            "hexRoad-010010-00.png","hexRoad-010010-01.png","hexRoad-010010-02.png",
            "hexRoad-010011-00.png",
            "hexRoad-010100-00.png","hexRoad-010100-01.png","hexRoad-010100-02.png",
            "hexRoad-010101-00.png","hexRoad-010101-01.png",
            "hexRoad-010110-00.png","hexRoad-010110-01.png",
            "hexRoad-010111-00.png",
            "hexRoad-011000-00.png","hexRoad-011000-01.png","hexRoad-011000-02.png",
            "hexRoad-011001-00.png","hexRoad-011001-01.png",
            "hexRoad-011010-00.png","hexRoad-011010-01.png",
            "hexRoad-011011-00.png",
            "hexRoad-011100-00.png","hexRoad-011100-01.png",
            "hexRoad-011101-00.png",
            "hexRoad-011110-00.png",
            "hexRoad-011111-00.png",
            "hexRoad-100000-00.png","hexRoad-100000-01.png","hexRoad-100000-02.png","hexRoad-100000-03.png",
            "hexRoad-100001-00.png","hexRoad-100001-01.png","hexRoad-100001-02.png",
            "hexRoad-100010-00.png","hexRoad-100010-01.png","hexRoad-100010-02.png",
            "hexRoad-100011-00.png",
            "hexRoad-100100-00.png","hexRoad-100100-01.png","hexRoad-100100-02.png",
            "hexRoad-100101-00.png","hexRoad-100101-01.png",
            "hexRoad-100110-00.png",
            "hexRoad-100111-00.png",
            "hexRoad-101000-00.png","hexRoad-101000-01.png","hexRoad-101000-02.png",
            "hexRoad-101001-00.png",
            "hexRoad-101010-00.png",
            "hexRoad-101011-00.png",
            "hexRoad-101100-00.png",
            "hexRoad-101101-00.png",
            "hexRoad-101110-00.png",
            "hexRoad-101111-00.png",
            "hexRoad-110000-00.png","hexRoad-110000-01.png","hexRoad-110000-02.png",
            "hexRoad-110001-00.png","hexRoad-110001-01.png",
            "hexRoad-110010-00.png","hexRoad-110010-01.png",
            "hexRoad-110011-00.png",
            "hexRoad-110100-00.png","hexRoad-110100-01.png",
            "hexRoad-110101-00.png","hexRoad-110101-01.png",
            "hexRoad-110110-00.png","hexRoad-110110-01.png",
            "hexRoad-110111-00.png","hexRoad-110111-01.png","hexRoad-110111-02.png","hexRoad-110111-03.png",
            "hexRoad-111000-00.png","hexRoad-111000-01.png",
            "hexRoad-111001-00.png","hexRoad-111001-01.png",
            "hexRoad-111010-00.png","hexRoad-111010-01.png","hexRoad-111010-02.png",
            "hexRoad-111011-00.png","hexRoad-111011-01.png","hexRoad-111011-02.png",
            "hexRoad-111100-00.png","hexRoad-111100-01.png",
            "hexRoad-111101-00.png","hexRoad-111101-01.png",
            "hexRoad-111110-00.png","hexRoad-111110-01.png","hexRoad-111110-02.png",
            "hexRoad-111111-00.png","hexRoad-111111-01.png","hexRoad-111111-02.png"
        ];

        // Cache for road variant lookup
        this.roadVariants = new Map();
        this.pavedVariants = new Map();
        this.bridgeVariants = new Map();
        // Paved highways and stone roads: the same runs as the dirt ones,
        // laid in setts (scripts/make_paved_roads.py makes them from the dirt sprites)
        for (const img of ROAD_IMAGES) {
            const m = img.match(/^hexRoad-([01]{6})-(\d+)\.png$/);
            if (!m) continue;
            const paved = img.replace('hexRoad-', 'hexRoadPaved-');
            if (!this.pavedVariants.has(m[1])) this.pavedVariants.set(m[1], []);
            this.pavedVariants.get(m[1]).push(paved);
        }
        for (const img of ROAD_IMAGES) {
            const roadMatch = img.match(/hexRoad-([01]{6})-(\d+)\.png/);
            const bridgeMatch = img.match(/hexRoadBridge-([01]{6})-(\d+)\.png/);
            
            if (bridgeMatch) {
                const key = bridgeMatch[1];
                if (!this.bridgeVariants.has(key)) {
                    this.bridgeVariants.set(key, []);
                }
                this.bridgeVariants.get(key).push(img);
            } else if (roadMatch) {
                const key = roadMatch[1];
                if (!this.roadVariants.has(key)) {
                    this.roadVariants.set(key, []);
                }
                this.roadVariants.get(key).push(img);
            }
        }

        const promises = [];

        // Building / Population Center Sprites
        const POP_PATH = 'assets/tiles/pop_center_images/';
        const BUILDING_PATH = 'assets/tiles/';
        const POP_IMAGES = {
            'settlement_capital': ['walledCity.png'],
            'settlement_town': ['village00.png', 'village01.png', 'village02.png', 'village03.png'],
            'settlement_village': ['villageSmall00.png', 'villageSmall01.png', 'villageSmall02.png', 'villageSmall03.png'],
            // a village still a camp of tents (scripts/make_world_camps.py)
            'settlement_camp': ['campCanvas00.png', 'campHide00.png'],
            'property_farm': ['farm00.png', 'farm01.png', 'farm02.png', 'farm03.png'],
            'property_mine': ['mine00.png', 'mine01.png', 'mine02.png', 'mine03.png'],
            'property_workshop': ['smithy.png'],
            'property_trading_post': ['inn.png'],
            'religion_shrine': ['standingStones.png'],
            'religion_temple': ['temple.png', 'hexDirtTemple00.png'],
            'religion_monastery': ['elvenLodge.png'],
            'poi_ruins': ['castleRuinDirt.png', 'castleRuinForest.png', 'castleRuinMarsh.png', 'desertRuins00.png', 'hexDirtTempleRuins00.png', 'templeRuins.png'],
            'poi_oasis': ['oasis00.png', 'oasis01.png', 'hexDesertDunesOasis00.png'],
            'poi_cave': ['hexMountainCave00.png', 'hexMountainCave01.png', 'volcanoCave.png'],
            'poi_monument': ['obelisk00.png', 'standingStones.png', 'hexPlainsHenge00.png'],
            'poi_shrine': ['hexDirtTemple00.png', 'standingStonesMossy.png'],
            'property_logging_camp': ['forester_hut00.png', 'forester_hut01.png', 'forester_hut02.png']
        };

        for (const [type, images] of Object.entries(POP_IMAGES)) {
            for (const imgName of images) {
                if (!this.tileSprites.has(imgName)) {
                    promises.push(this.loadTileSprite(imgName, POP_PATH + imgName));
                }
            }
        }

        // Inner-map building sprites (from assets/tiles/buildings/)
        const BUILDING_SPRITES = [
            'buildings/villageSmall00.png', 'buildings/villageSmall01.png',
            'buildings/villageSmall02.png', 'buildings/villageSmall03.png',
            'buildings/villageThatched00.png', 'buildings/villageThatched01.png',
            'buildings/villageThatched02.png', 'buildings/villageThatched03.png',
            'buildings/villageWood00.png', 'buildings/villageWood01.png',
            'buildings/villageWood02.png', 'buildings/villageWood03.png',
            'buildings/village00.png', 'buildings/village01.png',
            'buildings/village02.png', 'buildings/village03.png',
            'buildings/walledCity.png',
            'buildings/marketplace00.png', 'buildings/inn.png',
            'buildings/church00.png', 'buildings/temple.png',
            'buildings/barracks00.png',
            'buildings/granary00.png', 'buildings/granary01.png',
            'buildings/granaryStone00.png', 'buildings/granaryStone01.png',
            'buildings/warehouse00.png', 'buildings/smithy.png',
            'buildings/well00.png', 'buildings/well01.png',
            'buildings/barn00.png', 'buildings/barnWood00.png',
            'buildings/tent00.png',
            'buildings/sign00.png', 'buildings/sign01.png',
            // Decoration sprites — small / medium props
            'buildings/corral00.png', 'buildings/corral01.png', 'buildings/corral02.png',
            'buildings/corral00_cows.png', 'buildings/corral01_cows.png', 'buildings/corral02_cows.png',
            'buildings/pasture00.png', 'buildings/pasture00_sheep.png',
            'buildings/pen00.png', 'buildings/pen00_pigs.png',
            'buildings/foresterHut00.png', 'buildings/foresterHut01.png', 'buildings/foresterHut02.png',
            'buildings/foresterShed00.png',
            'buildings/well03.png', 'buildings/well04.png', 'buildings/well05.png',
            'buildings/windmill00.png',
            'buildings/cookhouse00.png',
            'buildings/loggingCamp00.png', 'buildings/loggingCamp01.png',
            'buildings/clayPit00.png', 'buildings/clayPit01.png',
            'buildings/archeryRange00.png',
            'buildings/scriptorium00.png',
            'buildings/alchemistsLab00.png',
            'buildings/mines00.png', 'buildings/mines01.png',
            'buildings/mines02.png', 'buildings/mines03.png',
            'buildings/windmillFields00.png',
            'buildings/walledCityMossy.png',
            'buildings/strongholdWood00.png', 'buildings/strongholdThatched00.png',
            'buildings/villageHalflingDecor00.png',
            'buildings/villageRuin00.png', 'buildings/villageRuin01.png',
            'buildings/villageRuin02.png', 'buildings/villageRuin03.png'
        ];
        for (const imgName of BUILDING_SPRITES) {
            if (!this.tileSprites.has(imgName)) {
                promises.push(this.loadTileSprite(imgName, BUILDING_PATH + imgName));
            }
        }

        for (const [terrain, images] of Object.entries(TERRAIN_IMAGES)) {
            for (const imgName of images) {
                // Check if already loaded
                if (!this.tileSprites.has(imgName)) {
                    promises.push(this.loadTileSprite(imgName, ASSET_PATH + imgName));
                }
            }
        }

        for (const imgName of RIVER_IMAGES) {
            if (!this.tileSprites.has(imgName)) {
                promises.push(this.loadTileSprite(imgName, RIVER_PATH + imgName));
            }
        }

        for (const imgName of ROAD_IMAGES) {
            if (!this.tileSprites.has(imgName)) {
                promises.push(this.loadTileSprite(imgName, ROAD_PATH + imgName));
            }
        }
        for (const list of (this.pavedVariants ? this.pavedVariants.values() : [])) {
            for (const imgName of list) {
                if (!this.tileSprites.has(imgName)) promises.push(this.loadTileSprite(imgName, ROAD_PATH + imgName));
            }
        }

        await Promise.all(promises);
        this.imagesLoaded = true;
        console.log('All tile assets loaded');
    },

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    },

    setWorld(world) {
        this.world = world;
    },

    setPlayer(player) {
        this.player = player;
    },

    /**
     * Load a PNG sprite for a terrain type
     * @param {string} id — e.g., 'hexPlains01.png'
     * @param {string} src — path to PNG file
     */
    loadTileSprite(id, src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.tileSprites.set(id, img);
                resolve(img);
            };
            img.onerror = () => {
                console.warn(`Failed to load image: ${src}`);
                resolve(null); // Resolve anyway to avoid blocking
            };
            img.src = src;
        });
    },

    /**
     * Get the specific image name for a tile based on its position and type
     */
    getTileImage(tile) {
        // Simple hash for deterministic random
        const hash = (tile.q * 73856093 ^ tile.r * 19349663) % 100;

        let variants = TV.none;
        let isAnimatedWater = false;

        // Map terrain ID to image variants
        switch (tile.terrain.id) {
            case 'deep_ocean':
                // Strictly dark, calm water from the ocean folder
                variants = TV.oceanCalm;
                isAnimatedWater = true;
                break;
            case 'ocean':
                // Standard ocean variants from the ocean folder (an atoll's reef: terrainGen 17)
                variants = tile._reef
                    ? TV.reef
                    : TV.oceanCalm;
                isAnimatedWater = true;
                break;
            case 'sea':
            case 'coast':
                // Lighter ocean variants for shallower water; a fjord's deep cold water between its cliffs
                variants = tile._fjord
                    ? TV.fjord
                    // (terrainGen 17: warm coral shallows, world/landscapes17.js)
                    : tile._reef ? TV.reef
                        : TV.oceanCalm;
                isAnimatedWater = true;
                break;
            case 'island':
                // Islands also use ocean folder assets; a skerry is bare rock (in cold seas, cold
                // water and lichen), never a sandy palm isle
                // (and no palm isle in a cold sea: any island there is rock)
                if ((tile.temperature ?? 0.5) < 0.45) variants = TV.skerry;
                else if (tile._skerry || (tile.temperature ?? 0.5) < 0.55) variants = TV.islandRocky;
                else variants = TV.islandSandy;
                break;
            case 'lake':
                // Lake uses ocean folder variants specifically for lakes
                variants = TV.lake;
                isAnimatedWater = true;
                break;
            case 'beach':
                // Temperate shores: cool shingle and dune grass, no palms
                if ((tile.temperature ?? 0.7) < 0.6) {
                    variants = TV.shingle;
                    break;
                }
                // Warm shores: a mix of plain sand and palms
                if (hash % 3 === 0) {
                    variants = TV.sandPalms;
                } else {
                    variants = TV.sand;
                }
                break;
            case 'plains':
                // Mix of regular plains and "dirt" variants for interest?
                if (hash < 10) variants = TV.dirt;
                else variants = TV.plains;
                break;
            case 'grassland':
                variants = TV.plains;
                break;
            case 'forest':
            case 'dense_forest':
            case 'woodland':
            case 'seasonal_forest':
            case 'temperate_rainforest':
            case 'tropical_rainforest':
            case 'boreal_forest':
                if (tile.temperature < 0.45 || tile.terrain.id === 'boreal_forest') {
                    // Pine / Cold forest
                    variants = tile.temperature < 0.2 ? TV.pineSnow : TV.pine;
                } else if (tile.terrain.id === 'tropical_rainforest') {
                    // Jungle-ish? Use broadleaf for now, maybe add more variation
                    variants = TV.forestBroadleaf;
                } else {
                    // Broadleaf
                    variants = (tile.terrain.id === 'woodland' || hash < 30) ? TV.broadleafWoods : TV.forestBroadleaf;
                }
                break;
            case 'desert':
                variants = hash < 10 ? TV.dunesRed : TV.dunes;
                break;
            case 'mountain':
            case 'snow_peak':
                if (tile.temperature < 0.5 || tile.terrain.id === 'snow_peak') {
                    variants = TV.mountainSnow;
                } else {
                    variants = TV.mountain;
                }
                break;
            case 'hills':
                if (tile.temperature < 0.2) {
                    variants = TV.hillsColdSnowCovered;
                } else if (tile.temperature < 0.4) {
                    variants = TV.hillsCold;
                } else {
                    variants = TV.hills;
                }
                break;
            case 'highlands':
                variants = TV.highlands;
                break;
            case 'swamp':
                // Use new wetlands assets mixed with old marsh for variety? Or just new ones?
                // Let's use the new high quality ones
                variants = TV.swamp;
                if (hash % 2 === 0) {
                    variants = TV.wetlands;
                }
                break;
            case 'snow':
            case 'ice':
                variants = TV.snowField;
                break;
            case 'tundra':
                variants = TV.plainsCold;
                break;
            case 'savanna':
                variants = TV.scrublands;
                break;
            // ── terrainGen 17 landscapes (world/landscapes17.js; art: scripts/terrain_art/landscape_tiles.py) ──
            case 'glacier':
                // an ice-capped peak where the land stands high, a crevassed ice field in the cold valleys
                variants = (tile.elevation ?? 0.9) >= 0.88
                    ? TV.glacierPeak
                    : TV.glacier;
                break;
            case 'badlands':
                variants = tile._canyon
                    ? TV.canyon
                    : TV.badlands;
                break;
            case 'volcano':
                variants = TV.volcano;
                break;
            case 'ash_plains':
                variants = TV.ashPlains;
                break;
            default:
                return null;
        }

        if (variants.length === 0) return null;

        // Water animation disabled for now
        // if (isAnimatedWater && variants.length > 1) {
        //     const tileOffset = Math.abs(hash) % variants.length;
        //     const index = (this.waterAnimFrame + tileOffset) % variants.length;
        //     return variants[index];
        // }

        const index = Math.abs(hash) % variants.length;
        return variants[index];
    },

    /**
     * The neighbour directions (Hex.neighbors indices) a hex's river runs to.
     * A generated river hex knows its downstream (riverDir), so it joins only
     * that and the river hexes flowing into it; painted rivers (no riverDir)
     * fall back to joining river neighbours whose elevation differs.
     */
    riverDirections(tile, q, r, width, height) {
        const dirs = [];
        if (!tile.hasRiver) return dirs;
        const neighbors = Hex.neighbors(q, r);
        const flows = Number.isInteger(tile.riverDir) && tile.riverDir >= 0;
        for (let i = 0; i < 6; i++) {
            const n = neighbors[i];
            if (n.r < 0 || n.r >= height) continue;
            const neighbor = this.world.tiles[n.r][Hex.wrapQ(n.q, width)];
            if (!neighbor) continue;
            let connected;
            if (flows || Number.isInteger(neighbor.riverDir)) {
                // (riverBranch: a delta's second way out, terrainGen 16)
                connected = (flows && (tile.riverDir === i || tile.riverBranch === i))
                    || (neighbor.hasRiver && (neighbor.riverDir === (i + 3) % 6 || neighbor.riverBranch === (i + 3) % 6));
            } else {
                const isWater = RIVER_WATER_IDS.has(neighbor.terrain.id);
                connected = (neighbor.hasRiver && Math.abs(neighbor.elevation - tile.elevation) > 0.0001)
                    || (isWater && tile.elevation > neighbor.elevation);
            }
            if (connected) dirs.push(i);
        }
        // (a river running out of a lake reaches back into it, not up from a spring beside it)
        if (flows) {
            const o = this.lakeOutletDir(tile, q, r, width, height);
            if (o >= 0 && !dirs.includes(o)) dirs.push(o);
        }
        return dirs;
    },

    /**
     * The direction from a river hex to the lake it runs out of, or -1: a
     * flowing hex that is no spring and has no river running into it, beside
     * a lake (the lake drains into it). The lake hex most nearly upstream of
     * its flow is the one it leaves.
     */
    lakeOutletDir(tile, q, r, width, height) {
        if (!tile || !tile.hasRiver || tile.riverSource || !Number.isInteger(tile.riverDir) || tile.riverDir < 0) return -1;
        const neighbors = Hex.neighbors(q, r);
        let best = -1, bestGap = -1;
        for (let i = 0; i < 6; i++) {
            const n = neighbors[i];
            if (n.r < 0 || n.r >= height) continue;
            const nt = this.world.tiles[n.r][Hex.wrapQ(n.q, width)];
            if (!nt) continue;
            if (nt.hasRiver && (nt.riverDir === (i + 3) % 6 || nt.riverBranch === (i + 3) % 6)) return -1;     // fed by a river: not an outlet
            if (!nt.terrain || nt.terrain.id !== 'lake') continue;
            const d = Math.abs(i - tile.riverDir), gap = Math.min(d, 6 - d);
            if (gap > bestGap) { bestGap = gap; best = i; }
        }
        return best;
    },

    /**
     * The neighbour directions a hex's road runs to: the links laid when the
     * road was built (roadLinks), else any road or settlement beside it.
     */
    roadDirections(tile, q, r, width, height) {
        const dirs = [];
        if (!tile.hasRoad) return dirs;
        if (Number.isInteger(tile.roadLinks)) {
            for (let i = 0; i < 6; i++) if (tile.roadLinks & (1 << i)) dirs.push(i);
            return dirs;
        }
        const neighbors = Hex.neighbors(q, r);
        for (let i = 0; i < 6; i++) {
            const n = neighbors[i];
            if (n.r < 0 || n.r >= height) continue;
            const neighbor = this.world.tiles[n.r][Hex.wrapQ(n.q, width)];
            if (neighbor && (neighbor.hasRoad || neighbor.settlement)) dirs.push(i);
        }
        return dirs;
    },

    /** Sprite mask key for a set of directions (direction i → bit (i+3)%6) */
    hexMaskKey(dirs) {
        let mask = 0;
        for (const i of dirs) mask |= (1 << ((i + 3) % 6));
        return mask.toString(2).padStart(6, '0');
    },

    pickVariant(variants, tile) {
        if (!variants || variants.length === 0) return null;
        const hash = (tile.q * 73856093 ^ tile.r * 19349663) % variants.length;
        return variants[Math.abs(hash)];
    },

    /**
     * Get the river overlay image for a tile
     */
    getRiverImage(tile, q, r, width, height) {
        if (!tile.hasRiver) return null;
        const dirs = this.riverDirections(tile, q, r, width, height);
        return this.pickVariant(this.riverVariants && this.riverVariants.get(this.hexMaskKey(dirs)), tile);
    },

    /**
     * Get the road overlay image for a tile
     */
    getRoadImage(tile, q, r, width, height) {
        if (!tile.hasRoad) return null;
        const dirs = this.roadDirections(tile, q, r, width, height);
        if (dirs.length === 0) return null;
        const key = this.hexMaskKey(dirs);
        if (this.isPavedRoad(tile)) {
            const paved = this.pickVariant(this.pavedVariants && this.pavedVariants.get(key), tile);
            if (paved && this.tileSprites && this.tileSprites.get(paved)) return paved;
        }
        return this.pickVariant(this.roadVariants && this.roadVariants.get(key), tile);
    },

    /** A road laid in stone: a paved highway (world/transport.js tier) or a built Stone Road. */
    isPavedRoad(tile) {
        if (!tile || !tile.hasRoad) return false;
        if (tile.roadTier === 'highway') return true;
        const inf = tile.infrastructure;
        return !!(inf && inf.id === 'stone_road' && !inf.underConstruction);
    },

    /**
     * Get the bridge overlay image for a tile where a road crosses a river.
     * The bridge sprites are keyed by the ROAD's run (a straight road over
     * the water) and carry only the road and bridge, so the river is still
     * drawn beneath. Null when the road there isn't straight (it bends or
     * forks on the crossing) — the plain road is drawn over the river then.
     */
    getBridgeImage(tile, q, r, width, height) {
        if (!tile.hasRoad || !tile.hasRiver) return null;
        const dirs = this.roadDirections(tile, q, r, width, height);
        if (dirs.length !== 2) return null;
        return this.pickVariant(this.bridgeVariants && this.bridgeVariants.get(this.hexMaskKey(dirs)), tile);
    },
});

