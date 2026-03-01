// ============================================
// RENDERER — Canvas rendering engine
// ============================================

import { Hex } from '../core/hex.js';
import { Religion } from '../systems/religion.js';
import { Economy } from '../world/economy.js';
import { Infrastructure } from '../systems/infrastructure.js';


export class Renderer {
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.camera = camera;
        this.hexSize = 54; // Radius of hex (center to vertex)
        this.world = null;
        this.player = null;

        // Hex dimensions
        this.hexWidth = Math.sqrt(3) * this.hexSize;
        this.hexHeight = 2 * this.hexSize;

        // Hover/selection state
        this.hoveredHex = null;
        this.selectedHex = null;
        this.reachableHexes = null;

        // Pre-drawn hex shapes cached
        this.terrainCache = new Map();

        // PNG tile sprites (when loaded)
        this.tileSprites = new Map();
        this.imagesLoaded = false;

        // Animation time
        this.time = 0;

        // Water animation
        this.waterAnimInterval = 1.2; // seconds between frame changes
        this.waterAnimFrame = 0;

        // Display settings
        this.showResources = true;
        this.showTerritories = false;

        // Map mode system
        // Modes: 'normal','political','religion','wealth','military','trade','culture'
        this.mapMode = 'normal';

        // Label management system to prevent overlapping
        this.labels = [];
        this.labelPadding = 5; // Extra space around labels for collision detection

        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Load assets
        this.loadAssets();
    }

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
            'highlands': ['hexHighlands01.png', 'hexHighlands02.png', 'hexHighlands03.png']
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
        this.bridgeVariants = new Map();
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

        await Promise.all(promises);
        this.imagesLoaded = true;
        console.log('All tile assets loaded');
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setWorld(world) {
        this.world = world;
    }

    setPlayer(player) {
        this.player = player;
    }

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
    }

    /**
     * Get the specific image name for a tile based on its position and type
     */
    getTileImage(tile) {
        // Simple hash for deterministic random
        const hash = (tile.q * 73856093 ^ tile.r * 19349663) % 100;

        let variants = [];
        let isAnimatedWater = false;

        // Map terrain ID to image variants
        switch (tile.terrain.id) {
            case 'deep_ocean':
                // Strictly dark, calm water from the ocean folder
                variants = ['ocean/hexOceanCalm00.png', 'ocean/hexOceanCalm01.png', 'ocean/hexOceanCalm02.png', 'ocean/hexOceanCalm03.png'];
                isAnimatedWater = true;
                break;
            case 'ocean':
                // Standard ocean variants from the ocean folder
                variants = ['ocean/hexOceanCalm00.png', 'ocean/hexOceanCalm01.png', 'ocean/hexOceanCalm02.png', 'ocean/hexOceanCalm03.png'];
                isAnimatedWater = true;
                break;
            case 'sea':
            case 'coast':
                // Lighter ocean variants for shallower water
                variants = ['ocean/hexOceanCalm00.png', 'ocean/hexOceanCalm01.png', 'ocean/hexOceanCalm02.png', 'ocean/hexOceanCalm03.png'];
                isAnimatedWater = true;
                break;
            case 'island':
                // Islands also use ocean folder assets
                variants = ['ocean/hexIslandSandy00.png', 'ocean/hexIslandSandy01.png', 'ocean/hexIslandRocky00.png', 'ocean/hexIslandRocky01.png'];
                break;
            case 'lake':
                // Lake uses ocean folder variants specifically for lakes
                variants = ['ocean/hexLake00.png', 'ocean/hexLake01.png', 'ocean/hexLake02.png', 'ocean/hexLake03.png'];
                isAnimatedWater = true;
                break;
            case 'beach':
                // Mix of plain sand and palms
                if (hash % 3 === 0) {
                    variants = ['tropics_wetlands/hexSandPalms00.png', 'tropics_wetlands/hexSandPalms01.png', 'tropics_wetlands/hexSandPalms02.png', 'tropics_wetlands/hexSandPalms03.png'];
                } else {
                    variants = ['tropics_wetlands/hexSand00.png', 'tropics_wetlands/hexSand01.png', 'tropics_wetlands/hexSand02.png', 'tropics_wetlands/hexSand03.png'];
                }
                break;
            case 'plains':
                // Mix of regular plains and "dirt" variants for interest?
                if (hash < 10) variants = ['hexDirt01.png', 'hexDirt02.png'];
                else variants = ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png'];
                break;
            case 'grassland':
                variants = ['hexPlains01.png', 'hexPlains02.png', 'hexPlains03.png'];
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
                    variants = ['cold/hexForestPine00.png', 'cold/hexForestPine01.png', 'cold/hexForestPine02.png', 'cold/hexForestPine03.png'];
                    if (tile.temperature < 0.2) {
                        variants.push('cold/hexForestPineSnowCovered00.png', 'cold/hexForestPineSnowCovered01.png');
                    }
                } else if (tile.terrain.id === 'tropical_rainforest') {
                    // Jungle-ish? Use broadleaf for now, maybe add more variation
                    variants = ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'];
                } else {
                    // Broadleaf
                    variants = ['hexForestBroadleaf01.png', 'hexForestBroadleaf02.png', 'hexForestBroadleaf03.png'];
                    if (tile.terrain.id === 'woodland' || hash < 30) variants.push('hexWoodlands01.png', 'hexWoodlands02.png', 'hexWoodlands03.png');
                }
                break;
            case 'desert':
                variants = ['hexDesertDunes01.png', 'hexDesertDunes02.png', 'hexDesertDunes03.png'];
                if (hash < 10) variants.push('hexDesertRedForest00.png');
                break;
            case 'mountain':
            case 'snow_peak':
                if (tile.temperature < 0.5 || tile.terrain.id === 'snow_peak') {
                    variants = ['cold/hexMountainSnow00.png', 'cold/hexMountainSnow01.png', 'cold/hexMountainSnow02.png', 'cold/hexMountainSnow03.png'];
                } else {
                    variants = ['hexMountain01.png', 'hexMountain02.png', 'hexMountain03.png'];
                }
                break;
            case 'hills':
                if (tile.temperature < 0.2) {
                    variants = ['cold/hexHillsColdSnowCovered00.png', 'cold/hexHillsColdSnowCovered01.png', 'cold/hexHillsColdSnowCovered02.png', 'cold/hexHillsColdSnowCovered03.png'];
                } else if (tile.temperature < 0.4) {
                    variants = ['cold/hexHillsCold00.png', 'cold/hexHillsCold01.png', 'cold/hexHillsCold02.png', 'cold/hexHillsCold03.png'];
                } else {
                    variants = ['hexHills01.png', 'hexHills02.png', 'hexHills03.png'];
                }
                break;
            case 'highlands':
                variants = ['hexHighlands01.png', 'hexHighlands02.png', 'hexHighlands03.png'];
                break;
            case 'swamp':
                // Use new wetlands assets mixed with old marsh for variety? Or just new ones?
                // Let's use the new high quality ones
                variants = ['tropics_wetlands/hexSwamp00.png', 'tropics_wetlands/hexSwamp01.png', 'tropics_wetlands/hexSwamp02.png', 'tropics_wetlands/hexSwamp03.png'];
                if (hash % 2 === 0) {
                    variants = ['tropics_wetlands/hexWetlands00.png', 'tropics_wetlands/hexWetlands01.png', 'tropics_wetlands/hexWetlands02.png', 'tropics_wetlands/hexWetlands03.png'];
                }
                break;
            case 'snow':
            case 'ice':
                variants = ['cold/hexSnowField00.png', 'cold/hexSnowField01.png', 'cold/hexSnowField02.png', 'cold/hexSnowField03.png'];
                break;
            case 'tundra':
                variants = ['cold/hexPlainsCold00.png', 'cold/hexPlainsCold01.png', 'cold/hexPlainsCold02.png', 'cold/hexPlainsCold03.png'];
                break;
            case 'savanna':
                variants = ['hexScrublands01.png', 'hexScrublands02.png', 'hexScrublands03.png'];
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
    }

    /**
     * Get the river overlay image for a tile
     */
    getRiverImage(tile, q, r, width, height) {
        if (!tile.hasRiver) return null;

        const neighbors = Hex.neighbors(q, r);
        let mask = 0;

        for (let i = 0; i < 6; i++) {
            const n = neighbors[i];
            const nwq = Hex.wrapQ(n.q, width);

            if (n.r < 0 || n.r >= height) continue;

            const neighbor = this.world.tiles[n.r][nwq];
            if (!neighbor) continue;

            // Connection logic
            const isWater = ['ocean', 'deep_ocean', 'lake', 'sea', 'coast'].includes(neighbor.terrain.id) || neighbor.elevation < 0.42;

            let connected = false;

            if ((neighbor.hasRiver) && Math.abs(neighbor.elevation - tile.elevation) > 0.0001) {
                connected = true;
            } else if (isWater && tile.elevation > neighbor.elevation) {
                connected = true;
            }

            if (connected) {
                // Map direction index to bit position:
                // West (3) -> Bit 0
                // NW (2)   -> Bit 5
                // NE (1)   -> Bit 4
                // East (0) -> Bit 3
                // SE (5)   -> Bit 2
                // SW (4)   -> Bit 1
                mask |= (1 << ((i + 3) % 6));
            }
        }

        const key = mask.toString(2).padStart(6, '0');
        const variants = this.riverVariants ? this.riverVariants.get(key) : null;

        if (!variants || variants.length === 0) return null;

        const hash = (tile.q * 73856093 ^ tile.r * 19349663) % variants.length;
        return variants[Math.abs(hash)];
    }

    /**
     * Get the road overlay image for a tile
     */
    getRoadImage(tile, q, r, width, height) {
        if (!tile.hasRoad) return null;

        const neighbors = Hex.neighbors(q, r);
        let mask = 0;

        for (let i = 0; i < 6; i++) {
            const n = neighbors[i];
            const nwq = Hex.wrapQ(n.q, width);

            if (n.r < 0 || n.r >= height) continue;

            const neighbor = this.world.tiles[n.r][nwq];
            if (!neighbor) continue;

            if (neighbor.hasRoad || neighbor.settlement) {
                // Same bitmask mapping as rivers:
                // Direction index -> bit position
                mask |= (1 << ((i + 3) % 6));
            }
        }

        if (mask === 0) return null;

        const key = mask.toString(2).padStart(6, '0');
        const variants = this.roadVariants ? this.roadVariants.get(key) : null;

        if (!variants || variants.length === 0) return null;

        const hash = (tile.q * 73856093 ^ tile.r * 19349663) % variants.length;
        return variants[Math.abs(hash)];
    }

    /**
     * Get the bridge overlay image for a tile (when road and river overlap)
     */
    getBridgeImage(tile, q, r, width, height) {
        if (!tile.hasRoad || !tile.hasRiver) return null;

        const neighbors = Hex.neighbors(q, r);
        let riverMask = 0;

        // Determine river direction by checking connected river neighbors
        for (let i = 0; i < 6; i++) {
            const n = neighbors[i];
            const nwq = Hex.wrapQ(n.q, width);

            if (n.r < 0 || n.r >= height) continue;

            const neighbor = this.world.tiles[n.r][nwq];
            if (!neighbor) continue;

            // Check if neighbor has river connection
            const isWater = ['ocean', 'deep_ocean', 'lake', 'sea', 'coast'].includes(neighbor.terrain.id) || neighbor.elevation < 0.42;
            let connected = false;

            if ((neighbor.hasRiver) && Math.abs(neighbor.elevation - tile.elevation) > 0.0001) {
                connected = true;
            } else if (isWater && tile.elevation > neighbor.elevation) {
                connected = true;
            }

            if (connected) {
                // Map direction to bitmask
                riverMask |= (1 << ((i + 3) % 6));
            }
        }

        if (riverMask === 0) return null;

        const key = riverMask.toString(2).padStart(6, '0');
        const variants = this.bridgeVariants ? this.bridgeVariants.get(key) : null;

        if (!variants || variants.length === 0) return null;

        const hash = (tile.q * 73856093 ^ tile.r * 19349663) % variants.length;
        return variants[Math.abs(hash)];
    }

    /**
     * Main render loop call
     */
    render(deltaTime) {
        this.time += deltaTime;
        this.waterAnimFrame = Math.floor(this.time / this.waterAnimInterval);
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear
        ctx.fillStyle = '#0a0e17';
        ctx.fillRect(0, 0, w, h);

        if (!this.world) return;

        ctx.save();

        // Render hex grid
        this.renderHexGrid(ctx);

        // Render rivers
        this.renderRivers(ctx);

        // Render territory borders
        this.renderTerritoryBorders(ctx);

        // Render trade route lines (map mode)
        this.renderTradeRoutes(ctx);

        // Render settlements
        this.renderSettlements(ctx);

        // Render improvements / POI
        this.renderImprovements(ctx);

        // Render holy sites & cultural buildings
        this.renderHolySitesAndCulture(ctx);

        // Render infrastructure (roads, bridges, irrigation)
        this.renderInfrastructure(ctx);

        // Render player-built structures (Farms, Mines, Temples)
        this.renderBuiltStructures(ctx);

        // Render resources
        this.renderResources(ctx);

        // Render path preview
        if (this.player && this.player.path) {
            this.renderPath(ctx, this.player.path);
        }

        // Render reachable hexes
        if (this.reachableHexes) {
            this.renderReachableHexes(ctx);
        }

        // Render player
        if (this.player) {
            this.renderPlayer(ctx);
        }

        // Render hover highlight
        if (this.hoveredHex) {
            this.renderHexHighlight(ctx, this.hoveredHex.q, this.hoveredHex.r, 'rgba(255,255,255,0.15)', 'rgba(255,255,255,0.4)');
        }

        // Render selected highlight
        if (this.selectedHex) {
            this.renderHexHighlight(ctx, this.selectedHex.q, this.selectedHex.r, 'rgba(245,197,66,0.15)', 'rgba(245,197,66,0.6)');
        }

        // Render units
        this.renderUnits(ctx);

        // Render caravans
        this.renderCaravans(ctx);

        // Render weather
        this.renderWeather(ctx);

        // Render all labels (with collision detection)
        this.renderLabels(ctx);

        ctx.restore();
    }

    /**
     * Add a label to the render queue with priority
     * @param {string} text - The label text
     * @param {number} x - Screen x position
     * @param {number} y - Screen y position
     * @param {number} priority - Higher priority labels are rendered first (1-10)
     * @param {object} style - Text style (font, fillStyle, strokeStyle, etc.)
     */
    addLabel(text, x, y, priority, style) {
        this.labels.push({ text, x, y, priority, style });
    }

    /**
     * Check if two label bounds overlap
     */
    labelsOverlap(label1, label2) {
        const padding = this.labelPadding;
        return !(
            label1.right + padding < label2.left - padding ||
            label1.left - padding > label2.right + padding ||
            label1.bottom + padding < label2.top - padding ||
            label1.top - padding > label2.bottom + padding
        );
    }

    /**
     * Measure and get bounds for a label
     */
    getLabelBounds(ctx, label) {
        ctx.font = label.style.font;
        const metrics = ctx.measureText(label.text);
        const width = metrics.width;
        const height = parseInt(label.style.font) || 12; // Extract font size as height approximation
        
        return {
            left: label.x - width / 2,
            right: label.x + width / 2,
            top: label.y - height / 2,
            bottom: label.y + height / 2
        };
    }

    /**
     * Render all non-overlapping labels based on priority
     */
    renderLabels(ctx) {
        if (this.labels.length === 0) return;

        // Sort labels by priority (highest first)
        this.labels.sort((a, b) => b.priority - a.priority);

        const renderedLabels = [];

        // Render labels that don't overlap with higher priority ones
        for (const label of this.labels) {
            const bounds = this.getLabelBounds(ctx, label);
            
            // Check if this label overlaps with any already rendered label
            let overlaps = false;
            for (const rendered of renderedLabels) {
                if (this.labelsOverlap({ ...label, ...bounds }, { ...rendered, ...rendered.bounds })) {
                    overlaps = true;
                    break;
                }
            }

            // If no overlap, render this label
            if (!overlaps) {
                // Apply style
                ctx.font = label.style.font;
                ctx.textAlign = label.style.textAlign || 'center';
                ctx.textBaseline = label.style.textBaseline || 'middle';

                // Draw shadow if specified
                if (label.style.shadowColor) {
                    ctx.fillStyle = label.style.shadowColor;
                    ctx.fillText(label.text, label.x + 1, label.y + 1);
                }

                // Draw main text
                ctx.fillStyle = label.style.fillStyle;
                ctx.fillText(label.text, label.x, label.y);

                // Save this label as rendered
                renderedLabels.push({ ...label, bounds });
            }
        }

        // Clear labels for next frame
        this.labels = [];
    }

    /**
     * Render active caravans
     */
    renderCaravans(ctx) {
        if (!this.player || !this.player.caravans) return;

        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const worldWidthPx = hexWidth * this.world.width;

        for (const caravan of this.player.caravans) {
            if (caravan.status !== 'traveling') continue;

            const start = this.getHexPixelPos(caravan.fromPos.q, caravan.fromPos.r);
            const end = this.getHexPixelPos(caravan.toPos.q, caravan.toPos.r);

            // Handle wrapping logic for shortest path interpolation
            let sx = start.x;
            let ex = end.x;
            const sy = start.y;
            const ey = end.y;

            if (Math.abs(ex - sx) > worldWidthPx / 2) {
                if (ex > sx) ex -= worldWidthPx;
                else ex += worldWidthPx;
            }

            const totalDays = Math.max(1, Math.ceil(caravan.distance / 2));
            const progress = 1 - (caravan.daysRemaining / totalDays);

            // Interpolate
            const cx = sx + (ex - sx) * progress;
            const cy = sy + (ey - sy) * progress;

            // Get screen position
            const screen = this.camera.worldToScreen(cx, cy);

            // Check visibility
            if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
            if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

            const renderSize = size * this.camera.zoom;

            // Draw Icon
            ctx.font = `${renderSize * 0.8}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Glowing effect
            ctx.shadowColor = 'rgba(255, 215, 0, 0.8)';
            ctx.shadowBlur = 10;
            ctx.fillStyle = '#ffffff';
            ctx.fillText('🐪', screen.x, screen.y);

            // Reset shadow
            ctx.shadowBlur = 0;

            // Draw Label
            if (this.camera.zoom > 0.6) {
                ctx.font = `bold 12px sans-serif`;
                ctx.fillStyle = '#ffcc00';
                ctx.strokeStyle = 'black';
                ctx.lineWidth = 2;
                ctx.strokeText(`${caravan.daysRemaining} days`, screen.x, screen.y - renderSize * 0.6);
                ctx.fillText(`${caravan.daysRemaining} days`, screen.x, screen.y - renderSize * 0.6);
            }
        }
    }

    /**
     * Get pixel position of a hex (Offset Coordinates)
     */
    getHexPixelPos(q, r) {
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;

        const px = q * hexWidth + ((r % 2 === 0) ? hexWidth / 2 : 0);
        const py = r * rowHeight;
        return { x: px, y: py };
    }

    /**
     * Render the hex grid terrain
     */
    renderHexGrid(ctx) {
        const bounds = this.camera.getVisibleBounds();
        const world = this.world;
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const hexHeight = 2 * size;
        const rowHeight = hexWidth * 0.75;

        // Determine visible bounds in Offset Grid (Row/Col)

        // Approximate visible range
        const padding = 2;
        const startRow = Math.floor((bounds.top) / rowHeight) - padding;
        const endRow = Math.ceil((bounds.bottom) / rowHeight) + padding;

        const minR = Math.max(0, startRow);
        const maxR = Math.min(world.height - 1, endRow);

        for (let r = minR; r <= maxR; r++) {
            // Apply Even-row offset (C# logic: y % 2 == 0 -> offset)
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;

            const startCol = Math.floor((bounds.left - offsetX) / hexWidth) - padding;
            const endCol = Math.ceil((bounds.right - offsetX) / hexWidth) + padding;

            const minQ = startCol;
            const maxQ = endCol;

            for (let q = minQ; q <= maxQ; q++) {
                // Handle wrapping
                const wq = Hex.wrapQ(q, world.width);
                const tile = world.tiles[r][wq];

                if (!tile.explored) continue; // FOW: skip unexplored tiles

                // Calculate Pixel Position using Offset Logic
                // q is column (x), r is row (y)
                const px = q * hexWidth + offsetX;
                const py = r * rowHeight;

                const screen = this.camera.worldToScreen(px, py);

                // Cull if off-screen (extra check)
                if (screen.x < -hexWidth * this.camera.zoom || screen.x > this.canvas.width + hexWidth * this.camera.zoom) continue;
                if (screen.y < -hexHeight * this.camera.zoom || screen.y > this.canvas.height + hexHeight * this.camera.zoom) continue;

                const renderSize = size * this.camera.zoom;

                // Check if we have a PNG sprite for this terrain
                const imgName = this.getTileImage(tile);

                // Log missing assets (once per session)
                if (!this.missingAssets) this.missingAssets = new Set();

                if (!imgName) {
                    if (!this.missingAssets.has(`TERRAIN_${tile.terrain.id}`)) {
                        console.warn(`[Renderer] No image mapping for terrain: ${tile.terrain.id}`);
                        this.missingAssets.add(`TERRAIN_${tile.terrain.id}`);
                    }
                } else if (!this.tileSprites.has(imgName)) {
                    if (!this.missingAssets.has(imgName)) {
                        console.warn(`[Renderer] Image asset missing: ${imgName} (for ${tile.terrain.id})`);
                        this.missingAssets.add(imgName);
                    }
                }

                const sprite = imgName ? this.tileSprites.get(imgName) : null;
                
                // Check for bridge first (road + river overlap)
                const bridgeImgName = this.getBridgeImage(tile, q, r, world.width, world.height);
                const bridgeSprite = bridgeImgName ? this.tileSprites.get(bridgeImgName) : null;
                
                // If we have a bridge, use it instead of separate river and road
                let riverSprite = null;
                let roadSprite = null;
                
                if (bridgeSprite) {
                    // Bridge replaces both river and road
                    roadSprite = bridgeSprite;
                } else {
                    // No bridge, render river and road separately
                    const riverImgName = this.getRiverImage(tile, q, r, world.width, world.height);
                    riverSprite = riverImgName ? this.tileSprites.get(riverImgName) : null;
                    const roadImgName = this.getRoadImage(tile, q, r, world.width, world.height);
                    roadSprite = roadImgName ? this.tileSprites.get(roadImgName) : null;
                }

                if (sprite || riverSprite || roadSprite) {
                    this.renderSpriteHex(ctx, screen.x, screen.y, renderSize, sprite, tile, riverSprite, roadSprite);
                }
            }
        }
    }

    /**
     * Render a hex with a solid color fill
     */
    renderColoredHex(ctx, cx, cy, size, tile) {
        const corners = Hex.hexCorners(cx, cy, size);

        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();

        // Fill with terrain color
        let fillColor = tile.terrain.color;

        // Dim if not currently visible (explored but not in LOS)
        if (!tile.visible) {
            fillColor = this.dimColor(fillColor, 0.45);
        }

        // Kingdom territory tint
        if (tile.kingdom && tile.visible) {
            const kingdom = this.world.getKingdom(tile.kingdom);
            if (kingdom) {
                // Blend territory color
                ctx.fillStyle = fillColor;
                ctx.fill();

                ctx.fillStyle = kingdom.colorLight;
                ctx.fill();

                // Subtle internal hex outline
                ctx.strokeStyle = this.dimColor(kingdom.color, 0.2);
                ctx.lineWidth = 0.5;
                ctx.stroke();
                return;
            }
        }

        ctx.fillStyle = fillColor;
        ctx.fill();

        // Subtle hex border
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    /**
     * Render a hex with a PNG sprite (clipped to hex shape)
     */
    renderSpriteHex(ctx, cx, cy, size, sprite, tile, overlaySprite = null, roadSprite = null) {
        const corners = Hex.hexCorners(cx, cy, size);

        ctx.save();



        // Draw sprite (Unclipped to allow overlap)
        const hexWidth = Math.sqrt(3) * size;
        const hexHeight = 2 * size;

        let targetWidth = hexWidth;
        let targetHeight = targetWidth;

        // Scale to COVER hex (max of width/height ratios)
        if (sprite && sprite.width && sprite.height) {
            const scaleX = (hexWidth / sprite.width);
            const scaleY = (hexHeight / sprite.height);
            const scale = Math.max(scaleX, scaleY); // fit exact

            targetWidth = sprite.width * scale;
            targetHeight = sprite.height * scale;
        }

        // Anchor sprite at bottom of hex (cy + size)
        const bottomY = cy + size;
        const drawX = cx - targetWidth / 2;
        const drawY = bottomY - targetHeight;

        if (sprite) {
            ctx.drawImage(sprite, drawX, drawY, targetWidth, targetHeight);
        }

        if (roadSprite) {
            ctx.drawImage(roadSprite, drawX, drawY, targetWidth, targetHeight);
        }

        if (overlaySprite) {
            // Use SAME frame as the base sprite to ensure perfect alignment
            // regardless of overlay transparency/crop
            ctx.drawImage(overlaySprite, drawX, drawY, targetWidth, targetHeight);
        }

        // Clip to hex shape for overlays
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();
        ctx.clip();

        // Fog dimming (dark overlay if not visible)
        if (!tile.visible) {
            ctx.fillStyle = 'rgba(10, 14, 23, 0.55)'; // Dark blue-black tint
            ctx.fill();
        }

        // Kingdom tint (overlay if visible and territory)
        if (this.showTerritories && tile.kingdom && tile.visible && this.mapMode === 'normal') {
            const kingdom = this.world.getKingdom(tile.kingdom);
            if (kingdom) {
                ctx.globalCompositeOperation = 'overlay';
                ctx.fillStyle = kingdom.colorLight;
                ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
            }
        }

        // Map mode overlay
        if (this.mapMode !== 'normal') {
            this.renderMapModeOverlay(ctx, tile);
        }

        ctx.restore();
    }

    /**
     * Render territory border lines between different kingdoms
     */
    renderTerritoryBorders(ctx) {
        if (!this.world || !this.showTerritories) return;
        const bounds = this.camera.getVisibleBounds();
        const world = this.world;
        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;
        const padding = 2;

        // Use same bound logic as renderHexGrid for consistency
        const startRow = Math.floor((bounds.top) / rowHeight) - padding;
        const endRow = Math.ceil((bounds.bottom) / rowHeight) + padding;

        const minR = Math.max(0, startRow);
        const maxR = Math.min(world.height - 1, endRow);

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Group edges by kingdom to draw them in batches for a "fully connected" look
        const kingdomEdges = new Map();

        for (let r = minR; r <= maxR; r++) {
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
            const startCol = Math.floor((bounds.left - offsetX) / hexWidth) - padding;
            const endCol = Math.ceil((bounds.right - offsetX) / hexWidth) + padding;

            for (let q = startCol; q <= endCol; q++) {
                const wq = Hex.wrapQ(q, world.width);
                const tile = world.tiles[r][wq];

                if (!tile.kingdom || !tile.explored) continue;

                const px = q * hexWidth + offsetX;
                const py = r * rowHeight;
                const screen = this.camera.worldToScreen(px, py);
                const renderSize = size * this.camera.zoom;

                // Check each neighbor for border
                const corners = Hex.hexCorners(screen.x, screen.y, renderSize);
                const neighbors = Hex.neighbors(q, r);
                const neighborIndices = [0, 5, 4, 3, 2, 1];

                for (let i = 0; i < 6; i++) {
                    const neighborIdx = neighborIndices[i];
                    const n = neighbors[neighborIdx];
                    const nwq = Hex.wrapQ(n.q, world.width);

                    // Correct tile retrieval for neighbor
                    const nTile = world.getTile(nwq, n.r);

                    if (!nTile || nTile.kingdom !== tile.kingdom) {
                        if (!kingdomEdges.has(tile.kingdom)) {
                            kingdomEdges.set(tile.kingdom, []);
                        }
                        // Store edges as pairs of points
                        kingdomEdges.get(tile.kingdom).push({
                            v1: corners[i],
                            v2: corners[(i + 1) % 6]
                        });
                    }
                }
            }
        }

        // Draw each kingdom's boundary
        for (const [kingdomId, edges] of kingdomEdges) {
            const kingdom = world.getKingdom(kingdomId);
            if (!kingdom) continue;

            const color = kingdom.color;
            const zoom = this.camera.zoom;

            // 1. Draw "Glow" / Outer Stroke
            ctx.beginPath();
            for (const edge of edges) {
                ctx.moveTo(edge.v1.x, edge.v1.y);
                ctx.lineTo(edge.v2.x, edge.v2.y);
            }

            ctx.shadowBlur = 12 * zoom;
            ctx.shadowColor = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 4.5 * zoom;
            ctx.globalAlpha = 0.4;
            ctx.stroke();

            // 2. Draw Main Solid Border
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1.0;
            ctx.lineWidth = 2.5 * zoom;
            ctx.strokeStyle = color;
            ctx.stroke();

            // 3. Draw Inner Highlight (Inner Glow Effect)
            ctx.lineWidth = 1.0 * zoom;
            ctx.strokeStyle = '#ffffff';
            ctx.globalAlpha = 0.6;
            ctx.globalCompositeOperation = 'overlay';
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }

        ctx.restore();
    }

    /**
     * Render settlements (capitals, towns, villages)
     */
    renderSettlements(ctx) {
        const bounds = this.camera.getVisibleBounds();
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.settlement || !tile.explored) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
                if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

                const settlement = tile.settlement;
                let imageName = '', labelSize = 10;

                switch (settlement.type) {
                    case 'capital':
                        imageName = 'walledCity.png';
                        labelSize = 13;
                        break;
                    case 'town':
                        const townVariants = ['village00.png', 'village01.png', 'village02.png', 'village03.png'];
                        imageName = townVariants[(q + r) % townVariants.length];
                        labelSize = 11;
                        break;
                    case 'village':
                        const villageVariants = ['villageSmall00.png', 'villageSmall01.png', 'villageSmall02.png', 'villageSmall03.png'];
                        imageName = villageVariants[(q + r) % villageVariants.length];
                        labelSize = 10;
                        break;
                    default:
                        labelSize = 9;
                }

                // Draw Sprite
                const sprite = this.tileSprites.get(imageName);
                if (sprite) {
                    const imgW = renderSize * 2.3;
                    const imgH = imgW * (sprite.height / sprite.width);
                    ctx.globalAlpha = 1.0;
                    ctx.drawImage(sprite, screen.x - imgW / 2, screen.y - imgH * 0.72, imgW, imgH);
                } else {
                    // Fallback to icon if image failed to load
                    const icon = settlement.type === 'capital' ? '🏰' : (settlement.type === 'town' ? '🏘️' : '🏠');
                    const iconSize = Math.max(14, renderSize * 0.9);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(icon, screen.x, screen.y - renderSize * 0.15);
                }

                // Draw name label
                if (this.camera.zoom > 0.4) {
                    const fsize = Math.max(10, labelSize * 1.1 * this.camera.zoom);
                    const font = `700 ${fsize}px 'Cinzel', serif`;
                    
                    // Add to label queue with priority based on settlement type
                    let priority = 5; // Default
                    if (settlement.type === 'capital') priority = 9;
                    else if (settlement.type === 'town') priority = 7;
                    else if (settlement.type === 'village') priority = 5;

                    this.addLabel(
                        settlement.name,
                        screen.x,
                        screen.y + renderSize * 0.45,
                        priority,
                        {
                            font: font,
                            fillStyle: '#ffffff',
                            shadowColor: 'rgba(0,0,0,0.9)',
                            textAlign: 'center',
                            textBaseline: 'top'
                        }
                    );
                }
            }
        }
    }

    /**
     * Render improvements/POI
     */
    renderImprovements(ctx) {
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.improvement || !tile.explored) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
                if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

                const poi = tile.improvement;
                let imageName = '';

                switch (poi.type) {
                    case 'ruins':
                        if (tile.terrain.id === 'desert') imageName = 'desertRuins00.png';
                        else if (tile.terrain.id === 'forest') imageName = 'castleRuinForest.png';
                        else if (tile.terrain.id === 'swamp') imageName = 'castleRuinMarsh.png';
                        else if (tile.terrain.id.includes('mountain')) imageName = 'templeRuins.png';
                        else imageName = 'castleRuinDirt.png';
                        break;
                    case 'oasis':
                        imageName = (q + r) % 2 === 0 ? 'oasis00.png' : 'hexDesertDunesOasis00.png';
                        break;
                    case 'cave':
                        if (tile.terrain.id.includes('volcano')) imageName = 'volcanoCave.png';
                        else imageName = (q + r) % 2 === 0 ? 'hexMountainCave00.png' : 'hexMountainCave01.png';
                        break;
                    case 'monument':
                        imageName = (q + r) % 2 === 0 ? 'obelisk00.png' : 'standingStones.png';
                        break;
                    case 'shrine':
                        imageName = (q + r) % 2 === 0 ? 'hexDirtTemple00.png' : 'standingStonesMossy.png';
                        break;
                }

                // Draw Sprite
                const sprite = this.tileSprites.get(imageName);
                if (sprite) {
                    const imgW = renderSize * 1.8;
                    const imgH = imgW * (sprite.height / sprite.width);
                    ctx.globalAlpha = 1.0;
                    ctx.drawImage(sprite, screen.x - imgW / 2, screen.y - imgH * 0.7, imgW, imgH);
                } else {
                    // Fallback to Icon
                    const iconSize = Math.max(12, renderSize * 0.7);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.globalAlpha = 1.0;
                    ctx.fillText(poi.icon, screen.x, screen.y);
                }

                // Draw name label for POIs
                if (this.camera.zoom > 0.7) {
                    const fsize = Math.max(9, 10 * this.camera.zoom);
                    const font = `700 ${fsize}px 'Cinzel', serif`;
                    
                    // Add to label queue with medium priority
                    this.addLabel(
                        tile.improvement.name,
                        screen.x,
                        screen.y + renderSize * 0.35,
                        4, // POIs have priority 4
                        {
                            font: font,
                            fillStyle: '#ffffff',
                            shadowColor: 'rgba(0,0,0,0.9)',
                            textAlign: 'center',
                            textBaseline: 'top'
                        }
                    );
                }
            }
        }
    }

    /**
     * Render holy sites and cultural buildings on the map
     */
    renderHolySitesAndCulture(ctx) {
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.explored) continue;
                const hasHoly = !!tile.holySite;
                const hasCultural = !!tile.culturalBuilding;
                if (!hasHoly && !hasCultural) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -60 || screen.x > this.canvas.width + 60) continue;
                if (screen.y < -60 || screen.y > this.canvas.height + 60) continue;

                if (hasHoly) {
                    const site = tile.holySite;
                    // Glow effect for holy sites
                    ctx.save();
                    ctx.shadowColor = '#f5c542';
                    ctx.shadowBlur = renderSize * 0.6;
                    ctx.globalAlpha = 0.6;
                    ctx.beginPath();
                    ctx.arc(screen.x, screen.y, renderSize * 0.4, 0, Math.PI * 2);
                    ctx.fillStyle = '#f5c542';
                    ctx.fill();
                    ctx.restore();

                    // Icon
                    const iconSize = Math.max(14, renderSize * 0.85);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.globalAlpha = 1.0;
                    ctx.fillText(site.icon, screen.x, screen.y);

                    // Label
                    if (this.camera.zoom > 0.5) {
                        const fsize = Math.max(9, 10 * this.camera.zoom);
                        const font = `700 ${fsize}px 'Cinzel', serif`;
                        
                        // Add to label queue with high priority
                        this.addLabel(
                            site.name,
                            screen.x,
                            screen.y + renderSize * 0.4,
                            8, // Holy sites have high priority
                            {
                                font: font,
                                fillStyle: '#f5c542',
                                shadowColor: 'rgba(0,0,0,0.9)',
                                textAlign: 'center',
                                textBaseline: 'top'
                            }
                        );
                    }
                }

                if (hasCultural) {
                    const building = tile.culturalBuilding;
                    const iconSize = Math.max(12, renderSize * 0.7);
                    ctx.font = `${iconSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.globalAlpha = 1.0;
                    ctx.fillText(building.icon, screen.x, screen.y);

                    if (this.camera.zoom > 0.7) {
                        const fsize = Math.max(8, 9 * this.camera.zoom);
                        const font = `700 ${fsize}px 'Cinzel', serif`;
                        
                        // Add to label queue with low priority
                        this.addLabel(
                            building.name,
                            screen.x,
                            screen.y + renderSize * 0.35,
                            3, // Cultural buildings have lower priority
                            {
                                font: font,
                                fillStyle: '#ffffff',
                                shadowColor: 'rgba(0,0,0,0.9)',
                                textAlign: 'center',
                                textBaseline: 'top'
                            }
                        );
                    }
                }
            }
        }
    }

    /**
     * Render infrastructure (roads, bridges, irrigation channels)
     */
    renderInfrastructure(ctx) {
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.infrastructure || !tile.explored) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                // Culling
                if (screen.x < -100 || screen.x > this.canvas.width + 100) continue;
                if (screen.y < -100 || screen.y > this.canvas.height + 100) continue;

                const infra = tile.infrastructure;
                const isUnderConstruction = infra.underConstruction;

                // Dim infrastructure that is still under construction
                if (isUnderConstruction) {
                    ctx.globalAlpha = 0.4;
                }

                if (infra.id === 'dirt_road' || infra.id === 'stone_road') {
                    // Draw road segments to neighbors that also have roads
                    const neighbors = Hex.neighbors(q, r);
                    ctx.strokeStyle = infra.renderColor || '#8B7355';
                    ctx.lineWidth = (infra.renderWidth || 2) * this.camera.zoom;
                    ctx.lineCap = 'round';

                    let hasConnection = false;
                    for (const n of neighbors) {
                        const wq = Hex.wrapQ(n.q, world.width);
                        const wr = n.r;
                        if (wr < 0 || wr >= world.height) continue;

                        const nTile = world.getTile(wq, wr);
                        if (!nTile || !nTile.infrastructure) continue;
                        if (!['dirt_road', 'stone_road', 'bridge'].includes(nTile.infrastructure.id)) continue;

                        const nPos = this.getHexPixelPos(wq, wr);
                        const nScreen = this.camera.worldToScreen(nPos.x, nPos.y);

                        ctx.beginPath();
                        ctx.moveTo(screen.x, screen.y);
                        ctx.lineTo(nScreen.x, nScreen.y);
                        ctx.stroke();
                        hasConnection = true;
                    }

                    // Draw center dot if no connections (standalone road tile)
                    if (!hasConnection) {
                        ctx.beginPath();
                        ctx.arc(screen.x, screen.y, renderSize * 0.15, 0, Math.PI * 2);
                        ctx.fillStyle = infra.renderColor || '#8B7355';
                        ctx.fill();
                    }

                    // Dotted line pattern for dirt roads
                    if (infra.id === 'dirt_road') {
                        ctx.setLineDash([]);
                    }
                } else if (infra.id === 'bridge') {
                    // Draw bridge icon
                    ctx.font = `${Math.max(14, renderSize * 0.7)}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('🌉', screen.x, screen.y - renderSize * 0.1);
                } else if (infra.id === 'irrigation_channel') {
                    // Draw irrigation - blue wavy lines
                    ctx.strokeStyle = infra.renderColor || '#4FC3F7';
                    ctx.lineWidth = (infra.renderWidth || 2) * this.camera.zoom;
                    ctx.globalAlpha = 0.7;

                    // Draw a small water channel pattern
                    const s = renderSize * 0.3;
                    ctx.beginPath();
                    ctx.moveTo(screen.x - s, screen.y + renderSize * 0.25);
                    ctx.quadraticCurveTo(screen.x - s * 0.5, screen.y + renderSize * 0.15, screen.x, screen.y + renderSize * 0.25);
                    ctx.quadraticCurveTo(screen.x + s * 0.5, screen.y + renderSize * 0.35, screen.x + s, screen.y + renderSize * 0.25);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;

                    // Small label
                    if (this.camera.zoom > 0.8) {
                        ctx.font = `${Math.max(10, renderSize * 0.35)}px serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('💧', screen.x, screen.y + renderSize * 0.45);
                    }
                }

                // Reset alpha after construction dimming
                if (isUnderConstruction) {
                    ctx.globalAlpha = 1.0;
                    // Draw construction indicator
                    ctx.font = `${Math.max(12, renderSize * 0.5)}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('🔨', screen.x, screen.y - renderSize * 0.3);
                }

                // Draw infrastructure name label at higher zoom
                if (this.camera.zoom > 1.0) {
                    const fsize = Math.max(8, 9 * this.camera.zoom);
                    const font = `${fsize}px 'Cinzel', serif`;
                    
                    // Add to label queue with low priority
                    const labelText = isUnderConstruction
                        ? `${infra.name} (${infra.constructionDaysLeft}d)`
                        : infra.name;
                    this.addLabel(
                        labelText,
                        screen.x,
                        screen.y + renderSize * 0.55,
                        2, // Infrastructure has priority 2
                        {
                            font: font,
                            fillStyle: infra.renderColor || '#ccc',
                            shadowColor: 'rgba(0,0,0,0.7)',
                            textAlign: 'center',
                            textBaseline: 'top'
                        }
                    );
                }
            }
        }
    }

    /**
     * Render player built properties and religious buildings
     */
    renderBuiltStructures(ctx) {
        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.explored) continue;
                const structure = tile.playerProperty || tile.religiousBuilding;
                if (!structure) continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -100 || screen.x > this.canvas.width + 100) continue;
                if (screen.y < -100 || screen.y > this.canvas.height + 100) continue;

                let imageName = '';

                // If there's a settlement, don't draw the structure sprite on top of it
                // Instead, maybe we could draw a small indicator badge, but for now just skip the sprite
                if (tile.settlement) {
                    // Do nothing, let the settlement sprite be the main visual
                } else if (tile.playerProperty) {
                    switch (tile.playerProperty.type) {
                        case 'farm':
                            const farmVars = ['farm00.png', 'farm01.png', 'farm02.png', 'farm03.png'];
                            imageName = farmVars[(q + r) % farmVars.length];
                            break;
                        case 'mine':
                            const mineVars = ['mine00.png', 'mine01.png', 'mine02.png', 'mine03.png'];
                            imageName = mineVars[(q + r) % mineVars.length];
                            break;
                        case 'workshop': imageName = 'smithy.png'; break;
                        case 'trading_post': imageName = 'inn.png'; break;
                        case 'logging_camp':
                            const loggingVars = ['forester_hut00.png', 'forester_hut01.png', 'forester_hut02.png'];
                            imageName = loggingVars[(q + r) % loggingVars.length];
                            break;
                        case 'pasture':
                            const pastureVars = ['corral00.png', 'corral01.png', 'corral02.png'];
                            imageName = pastureVars[(q + r) % pastureVars.length];
                            break;
                    }
                } else if (tile.religiousBuilding) {
                    switch (tile.religiousBuilding.type) {
                        case 'shrine': imageName = 'standingStones.png'; break;
                        case 'temple': imageName = 'temple.png'; break;
                        case 'monastery': imageName = 'elvenLodge.png'; break;
                    }
                }

                const sprite = this.tileSprites.get(imageName);
                if (sprite) {
                    const imgW = renderSize * 1.9;
                    const imgH = imgW * (sprite.height / sprite.width);
                    ctx.globalAlpha = 1.0;
                    ctx.drawImage(sprite, screen.x - imgW / 2, screen.y - imgH * 0.7, imgW, imgH);
                } else {
                    // Fallback Icon
                    ctx.font = `${Math.max(14, renderSize * 0.8)}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(structure.icon, screen.x, screen.y - renderSize * 0.1);
                }

                // Draw name label
                if (this.camera.zoom > 0.6) {
                    const fsize = Math.max(9, 10 * this.camera.zoom);
                    const font = `600 ${fsize}px 'Cinzel', serif`;
                    
                    // Add to label queue with low priority
                    this.addLabel(
                        structure.name,
                        screen.x,
                        screen.y + renderSize * 0.4,
                        3, // Built structures have priority 3
                        {
                            font: font,
                            fillStyle: '#ffffff',
                            shadowColor: 'rgba(0,0,0,0.8)',
                            textAlign: 'center',
                            textBaseline: 'top'
                        }
                    );
                }
            }
        }
    }

    /**
     * Render resources on tiles
     */
    renderResources(ctx) {
        if (!this.showResources || this.camera.zoom < 0.8) return; // Only show if enabled and at closer zoom

        const world = this.world;
        const size = this.hexSize;

        for (let r = 0; r < world.height; r++) {
            for (let q = 0; q < world.width; q++) {
                const tile = world.tiles[r][q];
                if (!tile.resource || !tile.visible) continue; // Resources only visible when in LOS

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
                if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

                // Small resource icon in corner of hex
                const iconSize = Math.max(9, renderSize * 0.4);
                ctx.font = `${iconSize}px serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Add shadow for visibility
                ctx.shadowColor = 'rgba(0,0,0,0.8)';
                ctx.shadowBlur = 4;
                ctx.fillStyle = '#ffffff';

                ctx.fillText(tile.resource.icon, screen.x + renderSize * 0.35, screen.y + renderSize * 0.35);

                // Reset shadow
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
            }
        }
    }

    /**
     * Render movement path
     */
    renderPath(ctx, path) {
        if (!path || path.length < 2) return;

        const size = this.hexSize;

        ctx.beginPath();
        for (let i = 0; i < path.length; i++) {
            const pos = this.getHexPixelPos(path[i].q, path[i].r);
            const screen = this.camera.worldToScreen(pos.x, pos.y);

            if (i === 0) {
                ctx.moveTo(screen.x, screen.y);
            } else {
                ctx.lineTo(screen.x, screen.y);
            }
        }

        ctx.strokeStyle = 'rgba(245, 197, 66, 0.6)';
        ctx.lineWidth = 3 * this.camera.zoom;
        ctx.setLineDash([8 * this.camera.zoom, 4 * this.camera.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Destination marker
        const lastHex = path[path.length - 1];
        const lastPos = this.getHexPixelPos(lastHex.q, lastHex.r);
        const lastScreen = this.camera.worldToScreen(lastPos.x, lastPos.y);

        const markerSize = 4 * this.camera.zoom;
        ctx.beginPath();
        ctx.arc(lastScreen.x, lastScreen.y, markerSize, 0, Math.PI * 2);
        ctx.fillStyle = '#f5c542';
        ctx.fill();
    }

    /**
     * Render reachable hex highlights
     */
    renderReachableHexes(ctx) {
        if (!this.reachableHexes) return;

        const size = this.hexSize;
        const pulse = Math.sin(this.time * 3) * 0.1 + 0.2;

        for (const [key] of this.reachableHexes) {
            const [q, r] = key.split(',').map(Number);
            const pos = this.getHexPixelPos(q, r);
            const screen = this.camera.worldToScreen(pos.x, pos.y);
            const renderSize = size * this.camera.zoom;

            if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
            if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

            const corners = Hex.hexCorners(screen.x, screen.y, renderSize * 0.92);
            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y);
            for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
            ctx.closePath();

            ctx.fillStyle = `rgba(245, 197, 66, ${pulse})`;
            ctx.fill();
        }
    }

    /**
     * Render hex highlight
     */
    renderHexHighlight(ctx, q, r, fillColor, strokeColor) {
        const size = this.hexSize;
        const pos = this.getHexPixelPos(q, r);
        const screen = this.camera.worldToScreen(pos.x, pos.y);
        const renderSize = size * this.camera.zoom;

        const corners = Hex.hexCorners(screen.x, screen.y, renderSize);

        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();

        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2 * this.camera.zoom;
        ctx.stroke();
    }

    /**
     * Render the player character
     */
    renderPlayer(ctx) {
        const size = this.hexSize;
        const pixelPos = this.getHexPixelPos(this.player.q, this.player.r);
        const screen = this.camera.worldToScreen(pixelPos.x, pixelPos.y);
        const renderSize = size * this.camera.zoom;

        // Player glow
        const glowPulse = Math.sin(this.time * 2) * 0.2 + 0.4;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, renderSize * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${glowPulse * 0.15})`;
        ctx.fill();

        // Player circle
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, renderSize * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a2e';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5 * this.camera.zoom;
        ctx.stroke();

        // Player icon
        const iconSize = Math.max(14, renderSize * 0.65);
        ctx.font = `${iconSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Show ship icon if player is boarded on a ship
        const displayIcon = this.player.boardedShip ? '⛵' : '👤';
        ctx.fillText(displayIcon, screen.x, screen.y);

        // Direction indicator / name
        if (this.camera.zoom > 0.7) {
            const fsize = Math.max(9, 11 * this.camera.zoom);
            const font = `700 ${fsize}px 'Inter', sans-serif`;
            
            // Add to label queue with highest priority
            this.addLabel(
                this.player.name,
                screen.x,
                screen.y + renderSize * 0.55,
                10, // Player has highest priority
                {
                    font: font,
                    fillStyle: '#ffffff',
                    shadowColor: 'rgba(0,0,0,0.6)',
                    textAlign: 'center',
                    textBaseline: 'top'
                }
            );
        }
    }

    /**
     * Get hex at screen position
     */
    getHexAtScreen(screenX, screenY) {
        const worldPos = this.camera.screenToWorld(screenX, screenY);

        const size = this.hexSize;
        const hexWidth = Math.sqrt(3) * size;
        // Reverting to 0.75 width spacing (perspective view) to match tiles
        const rowHeight = hexWidth * 0.75;

        // Estimate row and column
        const approxR = Math.round(worldPos.y / rowHeight);
        const approxQ = Math.round(worldPos.x / hexWidth);

        let bestHex = null;
        let minDistSq = Infinity;

        // Check neighborhood (R-1 to R+1, Q-1 to Q+1)
        for (let r = approxR - 1; r <= approxR + 1; r++) {
            for (let q = approxQ - 1; q <= approxQ + 1; q++) {
                // Check bounds (rows do not wrap)
                if (r < 0 || r >= this.world.height) continue;

                // Wrap Q
                const wq = Hex.wrapQ(q, this.world.width);

                // Get EXACT center of this candidate hex
                // We use the raw 'q' here to calculate position in unwrapped world space close to mouse
                const px = q * hexWidth + ((r % 2 === 0) ? hexWidth / 2 : 0);
                const py = r * rowHeight;

                const distSq = (worldPos.x - px) ** 2 + (worldPos.y - py) ** 2;

                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    bestHex = { q: wq, r: r };
                }
            }
        }

        return bestHex;
    }

    /**
     * Dim a hex color string
     */
    dimColor(colorStr, factor) {
        // Parse hex color
        const hex = colorStr.replace('#', '');
        const r = Math.floor(parseInt(hex.substr(0, 2), 16) * factor);
        const g = Math.floor(parseInt(hex.substr(2, 2), 16) * factor);
        const b = Math.floor(parseInt(hex.substr(4, 2), 16) * factor);
        return `rgb(${r},${g},${b})`;
    }

    /**
     * Render rivers
     */
    renderRivers(ctx) {
        // Rivers are now rendered as overlays in renderHexGrid
    }

    /**
     * Render dynamic world units
     */
    renderUnits(ctx) {
        if (!this.world || !this.world.units) return;

        const bounds = this.camera.getVisibleBounds();
        const size = this.hexSize;

        for (const unit of this.world.units) {
            // FOW: only show units on tiles the player can currently see
            const unitTile = this.world.getTile(unit.q, unit.r);
            if (!unitTile || !unitTile.visible) continue;

            const pos = this.getHexPixelPos(unit.q, unit.r);
            const screen = this.camera.worldToScreen(pos.x, pos.y);
            const renderSize = size * this.camera.zoom;

            // Simple culling
            if (screen.x < -100 || screen.x > this.canvas.width + 100) continue;
            if (screen.y < -100 || screen.y > this.canvas.height + 100) continue;

            const iconSize = Math.max(14, renderSize * 0.85);
            ctx.font = `${iconSize}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Draw unit icon
            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 6;
            ctx.fillText(unit.icon, screen.x, screen.y);
            ctx.restore();

            // Unit name label
            if (this.camera.zoom > 0.4) {
                const fsize = Math.max(8, 10 * this.camera.zoom);
                const font = `500 ${fsize}px 'Inter', sans-serif`;

                let color = '#ffffff';
                if (unit.type === 'raider' || unit.type === 'pirate') color = '#ff6666';
                if (unit.type === 'patrol') color = '#66ccff';
                if (unit.type === 'settler') color = '#ccff66';

                // Add to label queue with medium-low priority
                this.addLabel(
                    unit.name,
                    screen.x,
                    screen.y + renderSize * 0.4,
                    3, // Units have priority 3
                    {
                        font: font,
                        fillStyle: color,
                        shadowColor: 'rgba(0,0,0,0.7)',
                        textAlign: 'center',
                        textBaseline: 'top'
                    }
                );
            }
        }
    }

    /**
     * Render weather overlay
     */
    renderWeather(ctx) {
        if (!this.world || !this.world.weather) return;

        const bounds = this.camera.getVisibleBounds();
        const width = this.world.width;
        const height = this.world.height;
        const size = this.hexSize;
        const zoom = this.camera.zoom;

        const hexWidth = Math.sqrt(3) * size;
        const rowHeight = hexWidth * 0.75;
        const padding = 1;

        const startRow = Math.floor((bounds.top) / rowHeight) - padding;
        const endRow = Math.ceil((bounds.bottom) / rowHeight) + padding;
        const minR = Math.max(0, startRow);
        const maxR = Math.min(height - 1, endRow);

        // Batched drawing for performance
        // Rain
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(180, 200, 255, 0.4)';
        ctx.lineWidth = 1 * zoom;

        // Snow
        const snowParticles = []; // Store centers

        // Storm
        let hasStorm = false;

        for (let r = minR; r <= maxR; r++) {
            const offsetX = (r % 2 === 0) ? hexWidth / 2 : 0;
            const startCol = Math.floor((bounds.left - offsetX) / hexWidth) - padding;
            const endCol = Math.ceil((bounds.right - offsetX) / hexWidth) + padding;

            for (let q = startCol; q <= endCol; q++) {
                const wq = Hex.wrapQ(q, width);
                const weather = this.world.weather.getWeather(wq, r);

                if (weather.type === 'clear') continue;

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);

                // Random seed for this tile's particles
                const seed = (Math.sin(q * 12.9898 + r * 78.233) * 43758.5453);

                if (weather.type === 'rain' || weather.type === 'storm') {
                    // Draw rain lines
                    for (let i = 0; i < 3; i++) {
                        const rx = (seed * (i + 1) % 40) - 20;
                        const ry = (seed * (i + 2) % 40) - 20;
                        ctx.moveTo(screen.x + rx, screen.y + ry);
                        ctx.lineTo(screen.x + rx - 5 * zoom, screen.y + ry + 10 * zoom);
                    }
                    if (weather.type === 'storm') hasStorm = true;
                } else if (weather.type === 'snow') {
                    // Collect snow
                    for (let i = 0; i < 3; i++) {
                        const rx = (seed * (i + 1) % 40) - 20;
                        const ry = (seed * (i + 2) % 40) - 20;
                        // Deterministic snow?
                        if (Math.abs((seed * (i + 3)) % 1) < 0.5) snowParticles.push({ x: screen.x + rx, y: screen.y + ry });
                    }
                }
            }
        }
        ctx.stroke(); // Draw all rain

        // Draw Snow
        if (snowParticles.length > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.beginPath();
            for (const p of snowParticles) {
                ctx.moveTo(p.x, p.y);
                ctx.arc(p.x, p.y, 1.5 * zoom, 0, Math.PI * 2);
            }
            ctx.fill();
        }

        // Global Storm Overlay (Lightning flash)
        if (hasStorm) {
            // Random flash
            if (Math.random() < 0.01) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            }
            // Darken
            ctx.fillStyle = 'rgba(0, 0, 20, 0.15)';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    // ============================================
    // MAP MODE OVERLAY SYSTEM
    // ============================================

    /**
     * Render a map-mode colour overlay on a single hex.
     * Called inside renderSpriteHex after the hex clip path is set.
     */
    renderMapModeOverlay(ctx, tile) {
        let color = null;
        let alpha = 0.45;

        switch (this.mapMode) {
            case 'political': {
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k) color = k.color;
                    alpha = 0.35;
                } else {
                    color = '#222';
                    alpha = 0.15;
                }
                break;
            }

            case 'religion': {
                let faithId = null;
                if (tile.holySite) {
                    faithId = tile.holySite.faithId;
                    alpha = 0.65;
                } else if (tile.religiousBuilding) {
                    faithId = tile.religiousBuilding.faithId || (tile.kingdom && this.world.getKingdom(tile.kingdom)?.religion?.faithId);
                    alpha = 0.55;
                } else if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    faithId = k?.religion?.faithId;
                    alpha = 0.30;
                }
                if (faithId && Religion.FAITHS[faithId]) {
                    color = Religion.FAITHS[faithId].holyColor;
                } else {
                    color = '#1a1a2e';
                    alpha = 0.20;
                }
                break;
            }

            case 'wealth': {
                if (tile.settlement) {
                    const prod = Economy.calculateDetailedProduction(tile.settlement, tile, this.world);
                    const gold = prod ? prod.gold : 0;
                    // Scale: 0→red, 50→yellow, 150+→green
                    const t = Math.min(1, gold / 150);
                    const r = Math.round(255 * (1 - t));
                    const g = Math.round(200 * t);
                    color = `rgb(${r},${g},40)`;
                    alpha = 0.55;
                } else if (tile.resource) {
                    color = '#d4a017';
                    alpha = 0.30;
                } else if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k) {
                        const wealthPerHex = k.treasury / Math.max(1, k.territory.length);
                        const t = Math.min(1, wealthPerHex / 30);
                        const r = Math.round(200 * (1 - t));
                        const g = Math.round(180 * t);
                        color = `rgb(${r},${g},50)`;
                        alpha = 0.25;
                    }
                } else {
                    color = '#111';
                    alpha = 0.15;
                }
                break;
            }

            case 'military': {
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k) {
                        // Normalise military 0-5000 → intensity
                        const ratio = Math.min(1, k.military / 5000);
                        const r = Math.round(255 * ratio);
                        const g = Math.round(60 * (1 - ratio));
                        color = `rgb(${r},${g},30)`;
                        alpha = 0.35;
                        // Capital gets stronger tint
                        if (k.capital && tile.settlement && tile.settlement.type === 'capital') alpha = 0.55;
                    }
                } else {
                    color = '#111';
                    alpha = 0.10;
                }
                break;
            }

            case 'trade': {
                if (tile.hasRoad || (tile.infrastructure && tile.infrastructure.id)) {
                    color = '#f5c542';
                    alpha = 0.50;
                } else if (tile.settlement) {
                    color = '#e08e45';
                    alpha = 0.45;
                } else if (tile.resource) {
                    color = '#d4a017';
                    alpha = 0.30;
                } else if (tile.terrain && !tile.terrain.passable) {
                    color = '#0a0a20';
                    alpha = 0.40;
                } else {
                    color = '#111';
                    alpha = 0.10;
                }
                break;
            }

            case 'culture': {
                if (tile.culturalBuilding) {
                    const owner = tile.culturalBuilding.owner;
                    if (owner) {
                        const k = this.world.getKingdom(owner);
                        color = k ? k.color : '#9b59b6';
                    } else {
                        color = '#9b59b6';
                    }
                    alpha = 0.60;
                } else if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k && k.cultureData) {
                        const influence = k.cultureData.influence || 0;
                        const t = Math.min(1, influence / 100);
                        const r = Math.round(100 + 155 * t);
                        const g = Math.round(60 * (1 - t));
                        const b = Math.round(120 + 60 * t);
                        color = `rgb(${r},${g},${b})`;
                        alpha = 0.30;
                    }
                } else {
                    color = '#111';
                    alpha = 0.10;
                }
                break;
            }
        }

        if (color) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }
    }

    /**
     * Render trade route lines between settlements (used in 'trade' map mode)
     */
    renderTradeRoutes(ctx) {
        if (this.mapMode !== 'trade' || !this.world) return;

        const settlements = this.world.getAllSettlements();
        if (!settlements || settlements.length < 2) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(245, 197, 66, 0.25)';
        ctx.lineWidth = 2 * this.camera.zoom;
        ctx.setLineDash([6 * this.camera.zoom, 4 * this.camera.zoom]);

        // Draw connections between settlements within the same kingdom
        for (let i = 0; i < settlements.length; i++) {
            for (let j = i + 1; j < settlements.length; j++) {
                const a = settlements[i];
                const b = settlements[j];
                if (a.kingdom !== b.kingdom) continue;

                const dist = Hex.wrappingDistance(a.q, a.r, b.q, b.r, this.world.width);
                if (dist > 12) continue; // Only show nearby trade links

                const posA = this.getHexPixelPos(a.q, a.r);
                const posB = this.getHexPixelPos(b.q, b.r);
                const screenA = this.camera.worldToScreen(posA.x, posA.y);
                const screenB = this.camera.worldToScreen(posB.x, posB.y);

                ctx.beginPath();
                ctx.moveTo(screenA.x, screenA.y);
                ctx.lineTo(screenB.x, screenB.y);
                ctx.stroke();
            }
        }

        // Also draw pilgrim routes if Religion system shows them
        if (typeof Religion !== 'undefined' && Religion.PILGRIM_ROUTES) {
            ctx.strokeStyle = 'rgba(200, 160, 255, 0.30)';
            ctx.lineWidth = 2.5 * this.camera.zoom;
            ctx.setLineDash([4 * this.camera.zoom, 6 * this.camera.zoom]);

            for (const route of Religion.PILGRIM_ROUTES) {
                if (!route.from || !route.to) continue;
                const posA = this.getHexPixelPos(route.from.q, route.from.r);
                const posB = this.getHexPixelPos(route.to.q, route.to.r);
                const screenA = this.camera.worldToScreen(posA.x, posA.y);
                const screenB = this.camera.worldToScreen(posB.x, posB.y);

                ctx.beginPath();
                ctx.moveTo(screenA.x, screenA.y);
                ctx.lineTo(screenB.x, screenB.y);
                ctx.stroke();
            }
        }

        ctx.setLineDash([]);
        ctx.restore();
    }

    /**
     * Get colour for a tile based on current map mode (used by Minimap)
     */
    getMapModeColor(tile) {
        switch (this.mapMode) {
            case 'political':
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    return k ? k.color : tile.terrain.color;
                }
                return this.dimColor(tile.terrain.color, 0.5);

            case 'religion': {
                let faithId = null;
                if (tile.holySite) faithId = tile.holySite.faithId;
                else if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    faithId = k?.religion?.faithId;
                }
                if (faithId && Religion.FAITHS[faithId]) return Religion.FAITHS[faithId].holyColor;
                return '#1a1a2e';
            }

            case 'wealth': {
                if (tile.settlement) {
                    const prod = Economy.calculateDetailedProduction(tile.settlement, tile, this.world);
                    const g = prod ? prod.gold : 0;
                    const t = Math.min(1, g / 150);
                    return `rgb(${Math.round(255*(1-t))},${Math.round(200*t)},40)`;
                }
                if (tile.resource) return '#d4a017';
                if (tile.kingdom) return '#4a3520';
                return '#111';
            }

            case 'military': {
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k) {
                        const ratio = Math.min(1, k.military / 5000);
                        return `rgb(${Math.round(255*ratio)},${Math.round(60*(1-ratio))},30)`;
                    }
                }
                return '#111';
            }

            case 'trade': {
                if (tile.hasRoad || tile.infrastructure) return '#f5c542';
                if (tile.settlement) return '#e08e45';
                if (tile.resource) return '#d4a017';
                return tile.terrain.passable ? '#2a2520' : '#0a0a20';
            }

            case 'culture': {
                if (tile.culturalBuilding) return '#9b59b6';
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    if (k && k.cultureData) {
                        const inf = Math.min(1, (k.cultureData.influence || 0) / 100);
                        return `rgb(${Math.round(100+155*inf)},${Math.round(60*(1-inf))},${Math.round(120+60*inf)})`;
                    }
                }
                return '#111';
            }

            default:
                if (tile.kingdom) {
                    const k = this.world.getKingdom(tile.kingdom);
                    return k ? k.color : tile.terrain.color;
                }
                return tile.terrain.color;
        }
    }
}
