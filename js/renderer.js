// ============================================
// RENDERER — Canvas rendering engine
// ============================================

class Renderer {
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

        // Display settings
        this.showResources = true;

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


        const promises = [];

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

        // Map terrain ID to image variants
        switch (tile.terrain.id) {
            case 'deep_ocean':
                // Strictly dark, calm water from the ocean folder
                variants = ['ocean/hexOceanCalm00.png', 'ocean/hexOceanCalm01.png'];
                break;
            case 'ocean':
                // Standard ocean variants from the ocean folder
                variants = ['ocean/hexOceanCalm00.png', 'ocean/hexOceanCalm01.png', 'ocean/hexOceanCalm02.png', 'ocean/hexOceanCalm03.png'];
                break;
            case 'sea':
            case 'coast':
                // Lighter ocean variants for shallower water
                variants = ['ocean/hexOceanCalm01.png', 'ocean/hexOceanCalm02.png', 'ocean/hexOceanCalm03.png'];
                break;
            case 'island':
                // Islands also use ocean folder assets
                variants = ['ocean/hexIslandSandy00.png', 'ocean/hexIslandSandy01.png', 'ocean/hexIslandRocky00.png', 'ocean/hexIslandRocky01.png'];
                break;
            case 'lake':
                // Lake uses ocean folder variants specifically for lakes
                variants = ['ocean/hexLake00.png', 'ocean/hexLake01.png', 'ocean/hexLake02.png', 'ocean/hexLake03.png'];
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
     * Main render loop call
     */
    render(deltaTime) {
        this.time += deltaTime;
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

        // Render settlements
        this.renderSettlements(ctx);

        // Render improvements / POI
        this.renderImprovements(ctx);

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

        // Render weather
        this.renderWeather(ctx);

        ctx.restore();
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

                // if (!tile.explored) continue; // FOW Disabled

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
                const riverImgName = this.getRiverImage(tile, q, r, world.width, world.height);
                const riverSprite = riverImgName ? this.tileSprites.get(riverImgName) : null;

                if (sprite || riverSprite) {
                    this.renderSpriteHex(ctx, screen.x, screen.y, renderSize, sprite, tile, riverSprite);
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
        /*if (!tile.visible) {
            fillColor = this.dimColor(fillColor, 0.45);
        }*/

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
    renderSpriteHex(ctx, cx, cy, size, sprite, tile, overlaySprite = null) {
        const corners = Hex.hexCorners(cx, cy, size);

        ctx.save();



        // Draw sprite (Unclipped to allow overlap)
        const hexWidth = Math.sqrt(3) * size;
        const hexHeight = 2 * size;

        let targetWidth = hexWidth;
        let targetHeight = targetWidth;

        // Scale to COVER hex (max of width/height ratios)
        if (sprite.width && sprite.height) {
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
        /*if (!tile.visible) {
            ctx.fillStyle = 'rgba(10, 14, 23, 0.55)'; // Dark blue-black tint
            ctx.fill();
        }*/

        // Kingdom tint (overlay if visible and territory)
        if (tile.kingdom && tile.visible) {
            const kingdom = this.world.getKingdom(tile.kingdom);
            if (kingdom) {
                ctx.globalCompositeOperation = 'overlay'; // Blend mode for better looking tint
                ctx.fillStyle = kingdom.colorLight;
                ctx.fill();
                ctx.globalCompositeOperation = 'source-over'; // Reset
            }
        }

        ctx.restore();

        // Hex outline (subtle)
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 6; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();

        if (tile.kingdom && tile.visible) {
            const kingdom = this.world.getKingdom(tile.kingdom);
            if (kingdom) {
                // Very subtle internal outline
                ctx.strokeStyle = this.dimColor(kingdom.color, 0.25);
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }
    }

    /**
     * Render territory border lines between different kingdoms
     */
    renderTerritoryBorders(ctx) {
        if (!this.world) return;
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

                if (!tile.kingdom) continue;

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
                if (!tile.settlement) continue; // FOW Disabled: removed !tile.explored check

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
                if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

                const settlement = tile.settlement;
                let icon, labelSize;

                switch (settlement.type) {
                    case 'capital':
                        icon = '🏰';
                        labelSize = 12;
                        break;
                    case 'town':
                        icon = '🏘️';
                        labelSize = 10;
                        break;
                    case 'village':
                        icon = '🏠';
                        labelSize = 9;
                        break;
                    default:
                        icon = '📍';
                        labelSize = 9;
                }

                // Draw icon
                const iconSize = Math.max(14, renderSize * 0.9);
                ctx.font = `${iconSize}px serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(icon, screen.x, screen.y - renderSize * 0.15);

                // Draw name label
                if (this.camera.zoom > 0.6) {
                    const fsize = Math.max(8, labelSize * this.camera.zoom);
                    ctx.font = `600 ${fsize}px 'Cinzel', serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';

                    // Text shadow
                    ctx.fillStyle = 'rgba(0,0,0,0.7)';
                    ctx.fillText(settlement.name, screen.x + 1, screen.y + renderSize * 0.45 + 1);

                    ctx.fillStyle = tile.visible ? '#e8e0d4' : '#6b6156';
                    ctx.fillText(settlement.name, screen.x, screen.y + renderSize * 0.45);
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
                if (!tile.improvement) continue; // FOW Disabled: removed !tile.explored check

                const pos = this.getHexPixelPos(q, r);
                const screen = this.camera.worldToScreen(pos.x, pos.y);
                const renderSize = size * this.camera.zoom;

                if (screen.x < -50 || screen.x > this.canvas.width + 50) continue;
                if (screen.y < -50 || screen.y > this.canvas.height + 50) continue;

                const iconSize = Math.max(12, renderSize * 0.7);
                ctx.font = `${iconSize}px serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.globalAlpha = tile.visible ? 1 : 0.4;
                ctx.fillText(tile.improvement.icon, screen.x, screen.y);
                ctx.globalAlpha = 1;
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
                if (!tile.resource) continue; // FOW Disabled: removed !tile.visible check

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
        ctx.fillText('👤', screen.x, screen.y);

        // Direction indicator / name
        if (this.camera.zoom > 0.7) {
            const fsize = Math.max(9, 11 * this.camera.zoom);
            ctx.font = `700 ${fsize}px 'Inter', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillText(this.player.name, screen.x + 1, screen.y + renderSize * 0.55 + 1);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(this.player.name, screen.x, screen.y + renderSize * 0.55);
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
}
